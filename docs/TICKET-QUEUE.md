# Ticket queue and history

`/ticket list` defaults to active tickets, ten entries per page, oldest first. It includes open, closing and reopening records. Members see only their own tickets; staff can see all stored tickets.

```text
/ticket list state:closed
/ticket list state:all owner:@member
/ticket list state:open assignment:unassigned
/ticket list state:active handler:@staff
/ticket list state:closing
```

State accepts active, open, closing, closed, reopening or all. Staff can combine owner, handler and assignment filters. Assignment accepts all, assigned or unassigned. A handler match uses the saved claim, not role membership or current presence. Closed records can retain historical claims; reopening clears the previous assignment.

Members can browse their own active or closed history. They cannot filter another owner, inspect handler queues or request assignment filters. Unsupported inputs and pages beyond the filtered range return a clear error. Empty results have one valid empty page. Equal creation times use exact numeric channel ID order.

Replies are private, suppress mention notifications and preserve complete IDs. The list shows stored records, not proof that channels still exist or that closing/reopening has completed. Use ticket info to inspect a record, retry interrupted transitions and export available history through ticket transcript if current read access permits it.

Re-register commands after upgrading to 0.32.0. Filters do not mutate records, assign staff, change access or introduce a new store format. Live Discord queue validation remains part of release acceptance.
