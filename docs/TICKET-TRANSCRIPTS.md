# Ticket history exports

Owners and support staff can download text or JSON conversation snapshots in private responses. Guests cannot export through this command. Open or closed tickets need current requester and bot read access.

```text
/ticket transcript count:1000 format:json compression:gzip
/ticket transcript count:500 format:text before:123456789012345678
```

Defaults remain 50 messages, text, no compression and the current ticket channel. Count accepts 1 to 1000. The optional channel targets another stored ticket. Re-register commands after upgrading to 0.32.0 to expose the expanded options.

## Export older history

The bot reads up to ten pages of 100 messages from newest to oldest, then orders the file oldest first using exact numeric IDs. It stops at the requested count or a short/empty API page. The response and file include a next before cursor if older messages may remain. Run the command again with that cursor to continue without re-exporting the boundary message. New messages posted later are not included in an older-cursor request.

JSON export schema 2 records requested/returned counts, initial and next cursors, pages, historyExhausted, export time and limitations. A short API page means history ended during that read. Hitting the requested count leaves historyExhausted false conservatively, even if that message happens to be the oldest. Several exports can cover available history, but they are not a single atomic archive: edits/deletions between reads are not captured retrospectively.

Duplicate messages, cross-channel responses, stalled cursors, malformed content or collection exceeding the 45-second read budget fail the export. Each in-flight Discord request also has its own 12-second budget. Membership/role checks and upload occur outside the collection budget.

## Access and privacy

Before reading and again before returning a file, Latch checks current human membership, screening, support/admin privilege and effective View Channel plus Read Message History. It also checks the bot's effective read permissions and ticket privacy. Revoked privileges or overwrite changes during collection prevent delivery. Administrator and server-owner access follows Discord permission rules.

No local transcript is saved by the bot. It builds bounded data in memory, does not fetch attachment URLs and never writes conversation exports into stores or backups. Standard ticket export filenames are ignored by Git. Keep downloaded files outside the source checkout; custom unpack output names may not match ignore rules.

The export includes authors, IDs, returned text, timestamps, reply IDs, attachment names/links/sizes and embed text. It excludes deleted messages, messages outside the chosen window, attachment bytes, embed images, reactions, components, polls and stickers. Message Content access can affect returned text/embeds/attachments. Links can expire. An empty returned field does not prove an originally empty message. These limitations appear in every file. See Discord's [history endpoint and cursor limits](https://docs.discord.com/developers/resources/message#get-channel-messages) and [Message Content restrictions](https://docs.discord.com/developers/resources/message#message-object).

Private downloads and Discord attachments are additional copies of conversation data. Handle them under your server's retention policy. Latch cannot revoke downloaded copies or define Discord's attachment retention.

## Larger downloads and verification

Uncompressed uploads are limited to 2 MiB. Optional gzip compresses text or JSON while retaining the exact uncompressed bytes. Normalized source and uncompressed output each have an 8 MiB cap; compressed uploads still cannot exceed 2 MiB. Request fewer messages if either limit is exceeded. Content is never silently truncated.

The private response includes a SHA256 digest of the downloadable file. Compare it after downloading:

```powershell
Get-FileHash ./ticket-123456789012345678.json.gz -Algorithm SHA256
```

Unpack with Node using the included command from the Latch directory. Input/output paths can point to your Downloads folder:

```powershell
npm run transcript:unpack -- C:/Users/you/Downloads/ticket-123456789012345678.json.gz C:/Users/you/Downloads/ticket-123456789012345678.json
```

Use a new output file in an existing directory. The helper checks compressed and expanded limits, validates the text header or JSON schema and never replaces existing files. It writes the selected output only; it does not print conversation content. This validates the file structure and size, not authorship or cryptographic authenticity. Verify the digest separately.

## Release status

No new ticket store migration is introduced. The downloadable JSON schema changes from version 1 to 2, so consumers should use its explicit scope and pagination fields. Keep complete stopped-process backups for older ticket/economy/community format rollback.

Automated tests cover pagination, continuation, byte limits, compression, safe unpacking, permission revocation and signed runtime downloads. Actual Discord uploads/content access remain unverified. Full live acceptance is still required before stable release.
