with open('src/App.dnd.test.tsx', 'r') as f:
    lines = f.readlines()

end_of_test = -1
for i in range(len(lines)-1, -1, -1):
    if 'expect(screen.queryByText("Alpha Household")).not.toBeNull();' in lines[i]:
        end_of_test = i
        break

if end_of_test != -1:
    new_lines = lines[:end_of_test+1]
    new_lines.append('  });\n')
    new_lines.append('});\n')
    with open('src/App.dnd.test.tsx', 'w') as f:
        f.writelines(new_lines)
