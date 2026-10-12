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
