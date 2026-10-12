# AutoMod action policies

Use `/automod policy` to replace actions on a Latch message filtering rule. Filters, exemptions, names and enable state stay unchanged. This is a complete replacement: selecting block removes any previous alert and timeout actions.

| Mode | Required options | Result |
| --- | --- | --- |
| block | rule, mode | Block matching messages |
| alert | rule, mode, channel | Log matching content without blocking |
| block-alert | rule, mode, channel | Block and log |
| block-timeout | rule, mode, seconds | Block and timeout |
| block-alert-timeout | rule, mode, channel, seconds | Block, log and timeout |

Timeouts accept 1 to 2419200 seconds, only on keyword and mention rules. The requester needs Manage Server and Moderate Members. Discord also requires the bot to hold the permissions needed by the selected actions. Alert destinations must be current text or announcement channels in this server. Matching user content is logged there: choose a staff channel with appropriate access.

The command preserves a valid existing block explanation when blocking remains selected. Alert-only removes it; returning to blocking uses Discord's default explanation unless you set `/automod block-message` again. Unexpected action types are rejected rather than silently discarded. Duplicate policies send no update. Updates are serialized and audit reasons include the requester ID.

Review `/automod info` and Server Settings > AutoMod before enabling. Test with a non-exempt member in a non-exempt channel. Discord exemptions and platform behavior still apply. This feature has automated adapter tests; live Discord enforcement acceptance remains pending.

[Discord Auto Moderation reference](https://docs.discord.com/developers/resources/auto-moderation)

## Edit existing filters

- `/automod keywords-edit rule:<id> keywords:<comma-separated terms>` replaces the keyword list. Accepts 1 to 100 unique nonempty terms of up to 60 characters, within the command's 2000-character input. Existing regex patterns and allow words are preserved.
- `/automod mentions-edit rule:<id> limit:<1-50> raid-protection:<true|false>` updates the mention threshold. Omit raid-protection to preserve its current value. An explicit false disables raid detection.
- `/automod rename rule:<id> name:<new name>` preserves the rule ID and other settings. The Latch prefix is applied automatically, including on rules with the legacy OpenDesk prefix.

All require Manage Server, only edit rules created by this bot, serialize with other Latch AutoMod changes and preserve actions, exemptions and enable state. Identical updates send no write. Changes on an enabled rule apply immediately; disable it first if staff need to review the new filter. Discord API failures leave the local operation queue available for retry. External edits made simultaneously in Server Settings are not covered by this queue.
