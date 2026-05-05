## User Management

- users can add guests from the "Add Guest" button
  - click "Add Guest" button to show a modal form to add a new guest, with fields for full name, party, and circle.
  - guests can be added without a party or circle, but must have a full name
  - in the modal, guests can be added to an existing party or circle by selecting from a dropdown, or a new party/circle can be created by entering a new name in the dropdown input
- users can edit guests
  - right click a guest in the unassigned list or at a seat and selecting "Edit Guest" to show the modal form to edit the guest's full name, party, and circle
  - in the edit modal, users can change the guest's party or circle by selecting from a dropdown, or create a new party/circle by entering a new name in the dropdown input
- users can delete guests
  - right click a guest in the unassigned list or at a seat and selecting "Delete Guest" to show a confirmation modal to delete the guest
  - deleting a guest will remove them from any seat they are assigned to and remove them from the unassigned list
  - deleting a guest will also remove them from their party and circle, but will not delete the party or circle itself if they have other members. if there are no other members, the party or circle will be deleted as well.

## Assignment

- drag unassigned guest from unassigned list to an unassigned seat will assign the guest to the seat and remove from unassigned list
- drag unassigned guest from unassigned list to an assigned seat will fail
- drag unassigned guest from unassigned list to a table will activate autoseat to find the best seat for the guest in the table/adjacent tables
- drag assigned guest from assigned seatto a different unassigned seat will move the guest to the new seat
- drag assigned guest from assigned seat to a different assigned seat will swap the guests in the two seats
- drag assigned guest from assigned seat to a table will activate autoseat to find the best seat for the guest in adjacent tables and move the guest there
- drag a party from unassigned list to a table will activate autoseat to find the best seats for all members of the party in the table/adjacent tables
- drag a circle from unassigned list to a table will activate autoseat to find the best seats for all members of the circle in the table/adjacent tables
- drag a table to a different table will move all guests from the first table to the second table, moving all guests to the new table, keeping assigned guests assigned to the same seat number if possible, and activating autoseat for any guests that can't be assigned to the same seat number
- drag a table to the unassigned list will unassign all guests at the table

## UI Styling Conventions

- Theme foundation uses shadcn semantic tokens in `src/index.css` for both light and dark modes.
- Prefer utility-first classes in TSX components for local UI styling; keep `src/App.css` focused on shared global behaviors and legacy bridge selectors.
- Use semantic token utilities (`bg-card`, `text-foreground`, `border-border`, token-based arbitrary values) instead of fixed palettes.
- Keep drag-and-drop state marker classes (`is-over`, `is-dragging`, preview markers) intact when refactoring visuals so interaction behavior remains stable.
- For new UI states, define reusable semantic CSS variables in `src/index.css` first, then consume them from utilities/components.
