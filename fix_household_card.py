import re

with open('src/components/HouseholdCard.tsx', 'r') as f:
    content = f.read()

# Already looks like it doesn't have much icon-heavy stuff in the labels
# but let's re-read the request: "removing form label icons and host display from HouseholdCard"
# In current HouseholdCard.tsx:
# <div className="flex min-w-0 items-center gap-2 px-3 py-2.5 select-none">
#   <span className="min-w-0 flex-1 truncate text-xs font-medium text-card-foreground">
#     {party.household}
#   </span>
# </div>

# Actually, the icons might be in the form labels IF there was a form here, but it's a card.
# Wait, "form label icons" might be in a different component that HouseholdCard uses, or maybe I should look for a "GuestForm" or something?
# Oh, "removing form label icons and host display FROM HouseholdCard".
# HouseholdCard doesn't seem to have a host display. Let me check properties of 'party' (Party type).

with open('src/types.ts', 'r') as f:
    types = f.read()
print(types)
