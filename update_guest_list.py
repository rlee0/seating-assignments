import csv
import re

def run():
    # 1. Parse guest-list-raw.tsv
    name_to_group = {}
    with open('guest-list-raw.tsv', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            name_to_group[row['Full Name'].strip()] = row['Group Name'].strip()

    # 2. Parse guest-list-cleaned.md
    with open('guest-list-cleaned.md', 'r', encoding='utf-8') as f:
        lines = f.readlines()

    header_idx = -1
    for i, line in enumerate(lines):
        if line.strip().startswith('|') and 'Table Display Name' in line:
            header_idx = i
            break
    
    if header_idx == -1:
        print("Could not find table header.")
        return

    # Extract rows
    rows = []
    for i in range(header_idx + 2, len(lines)):
        line = lines[i].strip()
        if not line.startswith('|'):
            break
        # Split by | and strip
        parts = [p.strip() for p in line.split('|')]
        # parts[0] is empty because of leading |
        # columns: 1: S/R, 2: Table Display Name, 3: Group, 4: Table, 5: Full Name
        rows.append({
            'index': i,
            'sr': parts[1],
            'old_display': parts[2],
            'group': parts[3],
            'table': parts[4],
            'full_name': parts[5]
        })

    # 3. Exact matches
    exact_count = 0
    inferred_count = 0
    unresolved = []

    old_display_to_groups = {}
    
    for row in rows:
        fn = row['full_name']
        if fn in name_to_group:
            row['new_display'] = name_to_group[fn]
            exact_count += 1
            # Track mapping from old display to new groups for inference
            old_display_to_groups.setdefault(row['old_display'], set()).add(row['new_display'])
        else:
            row['new_display'] = None

    # 4. Inferred updates
    for row in rows:
        if row['new_display'] is None:
            old_disp = row['old_display']
            if old_disp in old_display_to_groups and len(old_display_to_groups[old_disp]) == 1:
                row['new_display'] = list(old_display_to_groups[old_disp])[0]
                inferred_count += 1
            else:
                unresolved.append(row['full_name'])
                row['new_display'] = row['old_display'] # keep old if unresolved

    # 5. Write back
    new_lines = lines[:header_idx+2]
    for row in rows:
        # Reconstruct the line
        # Assuming fixed column widths or just reasonable spacing
        line = f"| {row['sr']} | {row['new_display']} | {row['group']} | {row['table']} | {row['full_name']} |\n"
        new_lines.append(line)
    
    # Add any remaining lines after table
    last_table_idx = rows[-1]['index']
    new_lines.extend(lines[last_table_idx+1:])

    with open('guest-list-cleaned.md', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

    print(f"Total rows updated by exact match: {exact_count}")
    print(f"Inferred updates: {inferred_count}")
    if unresolved:
        print(f"Unresolved rows ({len(unresolved)}): {', '.join(unresolved)}")
    else:
        print("All rows resolved.")

if __name__ == '__main__':
    run()
