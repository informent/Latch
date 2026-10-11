# Persistent ticket panels

Ticket panels give members a visible entry point for private support. Staff draft a message, connect up to five topic buttons to categories and publish it. Members click a topic and receive a private link to their new or existing ticket. All features are free MIT-licensed source.

## Staff setup

Panel administration requires Manage Server or Administrator. Ticket handling and reopening separately require the configured support role or Administrator. Configure `DISCORD_SUPPORT_ROLE_ID` for the team; the everyone role is refused. That support role applies to every topic.

```text
/ticketpanel create title:Support desk description:Choose the topic that fits your request.
/ticketpanel add id:PANEL_ID topic:support label:General support category:SUPPORT_CATEGORY
/ticketpanel add id:PANEL_ID topic:report label:Report a problem category:REPORT_CATEGORY
/ticketpanel info id:PANEL_ID
/ticketpanel publish id:PANEL_ID
```

Create in an existing text channel in the configured guild. The draft saves without posting a message. Use its returned panel ID for later commands. Titles support up to 200 characters and descriptions up to 1000. Topic IDs contain lowercase letters, digits and hyphens, up to 20 characters. Labels support up to 60 characters. Categories must exist in the same guild. Limits are 20 panels and five topics per panel.

`list` shows all saved panels and retry state. `info` shows the message binding, topics/categories and pending retry. `remove` removes a topic; removing the last topic disables the panel. `disable` stops clicks immediately and removes buttons from the message when publication succeeds. `delete` marks the record for deletion, removes the published message and finally removes local state. Disable/delete failures retry durably.

## Member experience

Buttons verify the saved guild, channel, message, bot author, component type and topic. Copied messages, missing bindings, disabled panels and pending updates refuse clicks. The member must still belong to the guild, be human and have completed membership screening. The selected category is revalidated before channel creation.

Each owner can have only one active ticket. Repeated or concurrent clicks return that ticket instead of creating another. A ticket left closing/reopening also counts as active. The ticket has explicit everyone visibility denial plus owner, bot and configured support access. Category role permissions are not copied. Administrators and any manually added allows can affect effective visibility.

The topic is saved as the initial ticket reason. There is no intake form or transcript capture in this release. Members use `/ticket close` when finished; staff use `/ticket reopen` to restore a closed ticket. See [ticket recovery](TICKETS.md).

## Publication and recovery

Panel changes save before publication. The scheduler retries one due panel per pass, with delays from 15 seconds up to 15 minutes. Enable state and message ownership are checked before edits. Missing messages can be recreated with a new binding, making old buttons invalid. Buttons reject clicks until the current publication is confirmed.

Discord nonce protection is used for creation retries, but its window is limited. A successful send followed by failed binding persistence can leave an extra message outside that window. Such unbound copies refuse clicks; staff should remove them after inspecting panel info. Externally changed message ownership blocks mutation and leaves a visible retry state. Fix permissions/categories, then inspect or republish.

Stopping drains queued panel work and stops retry timers. If a ticket is saved but its private response fails, use `/ticket list` or click the panel again to retrieve the existing ticket. Panel deletion never deletes ticket channels or ticket records.

## Deployment and backup

The new eleventh store is `TICKET_PANEL_STORE_PATH`, default `./data/ticket-panels.json`. It holds guild, panel/channel/message IDs, configured descriptions, topic/category IDs, state and retry metadata. It does not store credentials, interaction tokens or member conversations. Its version 1 format is guild-bound and capped at 1 MiB. Include it in complete stopped-process backups. Run one bot process per store set.

Run `npm run register` after upgrading. Doctor inspects this store and rejects overlapping store paths. Docker Compose and Linux service templates include its persistent path. No Docker/service execution or live Discord validation was performed here. Automated tests exercise signed local HTTP requests and simulated Discord responses, including restart, failed writes, private channel creation, closure and reopening.

## Browse every saved entry

`/ticketpanel list` shows five entries per page, ordered by numeric ID. Use `/ticketpanel list page:2` for the next page. Responses show totals, page counts, full titles and pending publication status. Empty lists show page 1/1; unavailable pages return the valid range. Re-register commands after upgrading to expose the optional page argument.
