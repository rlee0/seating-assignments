# Seating Chart App Specification

## Overview

Build a desktop-oriented web app for arranging wedding or event guests at tables.

- Guests belong to a household.
- Households belong to a group.
- The app loads guest data from `guest-list.md`.
- The app allows the user to seat guests by dragging and dropping guests, households, and groups into a seating chart.

## Source Data

### Guest List Source of Truth

- On app load, the source of truth for guest data is `guest-list.md`.
- `guest-list.md` is a markdown table containing `Host`, `Group`, `Household`, and `Guest` columns.
- The app must parse `guest-list.md` and derive the sidebar hierarchy from it.
- The sidebar hierarchy is:
  - Host
  - Group
  - Household
  - Guest
- The app must preserve the authored guest, household, and group display names exactly as written in the markdown file.
- The app must generate stable internal IDs from `Host + Group + Household + Guest` so seating state, import/export, and persistence remain consistent across reloads.

### Markdown Reload Behavior

- The app must provide a manual `Reload from markdown` action.
- Reloading reparses `guest-list.md` and refreshes the sidebar and warnings.
- Warnings reset on each markdown parse.
- The app should load valid rows even if some rows are malformed.
- Malformed rows should be skipped and reported as warnings.
- Duplicate guest identity rows should be reported as warnings.

## Seating Chart Layout

### Table Grid

- The seating chart is 5 rows of 5 tables.
- Tables in each row are arranged end-to-end.
- Each table has 8 seats by default.
- Base layout per table: 4 seats on each long side.

### Optional End Seats

- Only the first and last table in each row are eligible for one additional seat.
- The extra seat is on the outer open end of the table.
- An eligible table therefore has either:
  - 8 seats when the extra seat is disabled, or
  - 9 seats when the extra seat is enabled.
- Disabled extra seats are treated as unavailable during placement.

### Table Metadata

- Each table should show a table number.
- Each table should show occupied seat count versus total enabled seat count.

## Sidebar Behavior

### Hierarchy and Search

- The sidebar must render the hierarchy `Host > Group > Household > Guest`.
- The sidebar must include search.
- Search must match:
  - group names
  - household names
  - guest names
- Search must be case-insensitive.
- Search must be diacritic-insensitive and Unicode-safe.

### Available-Only Visibility

- The sidebar should only show unseated entities.
- When a guest is seated, that guest should no longer appear in the sidebar.
- When all guests in a household are seated, that household should no longer appear in the sidebar.
- When all households in a group are seated, that group should no longer appear in the sidebar.

## Drag and Drop Rules

### Supported Drag Sources

- The user can drag a guest, household, or group from the sidebar into the seating chart.
- In v1, once seated, only individual guests can be dragged from the chart.
- In v1, seated households and seated groups do not have chart-level drag handles.

### Valid Drop Targets

- Guest drops target individual seats.
- Household drops target a table body area.
- Group drops target the seating chart or a table context that begins placement from that location.

### Guest Placement

- When a guest is dropped onto an empty seat, that seat is filled with that guest.
- A guest can occupy only one seat at a time.
- A guest that is already seated cannot be placed again elsewhere unless first moved or unseated.

### Household Placement

- When a household is dropped onto a table, the app should attempt to seat all unseated household members.
- The target table is filled first.
- If the target table does not have enough available seats, the remaining household members overflow to the next available tables.

### Group Placement

- When a group is dropped, the app should attempt to seat all unseated guests in that group.
- Placement proceeds in deterministic order based on the parsed markdown order.
- The target location is filled first, then remaining guests overflow to the next available tables.

### Overflow Order

- Seat filling within a table must use deterministic seat order.
- Overflow across tables must use row-major order.
- Row-major order means top-left table to top-right table, then the next row, continuing to the bottom-right table.

### Partial Placement

- If there is not enough total capacity for a dropped household or group, the app should place as many guests as possible.
- Partial placement should produce a warning so the user knows some guests could not be seated.

### Preventing Duplicate Seating

- A fully seated guest, household, or group cannot be dropped again.
- Re-dropping a fully seated entity should be prevented and should not create duplicate seated guests.

### Swap Behavior

- Swap behavior applies only to single guest drops.
- If the user drops one guest onto an occupied seat, the dragged guest and the seated guest swap positions.
- Household and group drops do not trigger swap behavior.
- Household and group drops only fill remaining valid seats.

## Moving and Removing Guests

### Moving a Seated Guest

- The user can drag a seated guest from one seat to another.
- If dropped onto an empty seat, the guest moves and the original seat is cleared.
- If dropped onto an occupied seat, the two guests swap positions.

### Removing a Guest

- The user can drag a seated guest back to the sidebar to unseat that guest.
- The user can also drag a seated guest to an empty area of the seating chart to remove that guest.
- Removal by dropping onto empty chart space must require a short hover-and-hold delay before the remove indicator appears.
- This interaction should feel similar to the macOS Dock removal behavior.

## Warnings

- The app must show a warning counter.
- When the warning counter is clicked, the app must show the full list of current warnings.
- V1 only needs a single warning type/list, not multiple severity levels.
- Warnings should cover at least:
  - malformed markdown rows
  - duplicate guest identities
  - partial placement due to insufficient capacity
  - import rows that reference unknown guests

## Import and Export

### Export

- The app must export the current seating arrangement as JSON.
- The exported JSON must include a schema version.
- The exported JSON must include a timestamp.
- The exported JSON must include enough information to restore:
  - current seating assignments
  - enabled optional end seats

### Import

- The app must import a saved seating arrangement from JSON.
- Import replaces the current seating state.
- If imported guest IDs do not exist in the current guest list, those guest assignments should be skipped.
- Unknown guest assignments should be summarized as warnings after import.
- Import should create an undoable state transition.

## Undo, Redo, and Persistence

### Undo and Redo

- The app must support:
  - `Cmd+Z` for undo
  - `Cmd+Shift+Z` for redo
- Undo and redo should be tracked per action.
- The undo/redo history should cover:
  - seat guest
  - move guest
  - swap guests
  - unseat guest
  - import seating arrangement
- UI-only actions such as typing in search should not create undo states.
- Markdown reload should not create undo states.
- History is capped at 100 states.

### Local Persistence

- The app must persist to local storage:
  - current seating arrangement
  - enabled optional end seats
  - undo/redo stacks
- On reload, the app should restore the persisted seating state.

## Keyboard Interactions

- The app must support:
  - `Cmd+Z` undo
  - `Cmd+Shift+Z` redo
  - `Esc` cancel drag or selection
  - `Delete` or `Backspace` clear the currently selected seat

## User Interface Requirements

- The app should have a clean, intuitive, desktop-first interface.
- Drag-and-drop interactions should have clear visual feedback.
- Valid drop targets should be visually distinguishable from invalid ones.
- The UI should remain usable across different screen sizes, but the primary target is desktop usage.
- The design and component choices should align with a React + TypeScript + shadcn UI stack.

## Technical Requirements

- Tech stack:
  - Node.js
  - React
  - TypeScript
  - shadcn
  - Zustand with persistence to local storage
  - drag-and-drop library

## Out of Scope for V1

- Multi-select drag operations
- Dragging seated households as a unit from the chart
- Dragging seated groups as a unit from the chart
- Multiple warning severity levels
- Automatic live watching of `guest-list.md`
