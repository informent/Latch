# Ticket conversation exports

```text
/ticket transcript count:50 format:text
/ticket transcript count:100 format:json channel:#ticket
```

The owner or support staff can request a private downloadable snapshot of 1 to 100 recent messages. Defaults are 50 messages, text format and the current channel. Closed tickets remain exportable while the requester and bot retain access. Guests cannot export conversations through this command.

Latch checks current human membership, completed screening, current support roles or administrator status and effective View Channel/Read Message History permissions. It checks ticket privacy and verifies that channel overwrites stayed unchanged during the read. Permission failures do not return a file.

## What is included

Messages appear oldest first within the selected recent window, ordered by exact numeric message ID. Text and JSON include author IDs/names, message IDs, returned text, creation/edit timestamps, reply IDs, attachment names/links/sizes and embed titles/descriptions/fields. JSON includes a versioned recent-snapshot scope, requested/returned counts, export time and limitations. Unexpected response fields are not copied.

This is not a full channel archive. Older/deleted messages, attachment bytes, embed images, reactions, interactive components, polls and stickers are excluded. Attachment links can expire. Discord can omit message text, embeds and attachments when Message Content access is not configured or approved. Empty text is not proof that a message was originally empty. Enable the appropriate privileged intent in the Developer Portal if needed and verify actual content in a private server. See Discord's [message-content restrictions](https://docs.discord.com/developers/resources/message#message-object).

## Download and privacy

The command defers privately and uploads one text/plain or application/json attachment to that private response. No HTML or executable content is generated. Mentions in the response do not notify users. Latch builds the snapshot in memory, does not fetch attachment URLs and never writes a local transcript or transcript data into stores/backups. The downloaded file and Discord response are additional copies of private conversation data; handle them according to your server's retention policy.

Files are limited to 2 MiB. Oversized exports fail instead of truncating content; request fewer messages. API errors do not reveal response bodies or credentials. A failed upload does not leave a local file. The bot cannot revoke downloaded copies, and this feature does not establish a deletion/retention policy for Discord-hosted attachments.

The upload uses Discord's [multipart file protocol](https://docs.discord.com/developers/reference#uploading-files) and [edit webhook message endpoint](https://docs.discord.com/developers/resources/webhook#edit-webhook-message). Automated tests cover exact bytes, attachment metadata, rate-limit retries, permission failures and signed runtime commands. Real Discord upload/content validation remains required before stable release.

## Upgrade

Re-register commands after upgrading to 0.31.0. This feature does not introduce another store format. Continue backing up the entire stopped-process store set; existing ticket format 2, economy format 3 and community format 3 still require compatible complete backups when rolling back to older releases.
