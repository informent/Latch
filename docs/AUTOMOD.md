# Native AutoMod

Latch manages native Discord AutoMod rules. Staff and bot need Manage Server. Rules reside in Discord, with no new local store, Gateway message capture or external provider. All commands reply privately and suppress mentions.

## Create and review

```text
/automod keywords name:Blocked terms keywords:spam,*scam*
/automod mentions name:Mention safety limit:5
/automod spam name:Spam safety
/automod presets name:Community safety preset:all
/automod list
/automod info rule:RULE_ID
/automod enable rule:RULE_ID
```

Creation leaves rules disabled. Presets select profanity, sexual content, slurs or all three built-in wordsets. Discord enforces rule-count limits and filtering behavior. Inspect rules and review Server Settings > AutoMod before enabling them. Native filtering continues independently of the Latch process.

`list` shows server rules, including rules Latch cannot change. `info`, edits and removal require an exact matching rule ID/guild ID, this bot as creator, and the Latch name prefix. Renaming a rule to remove the prefix prevents later Latch management. Changing bot identity also prevents access to earlier rules through these commands.

## Configure exemptions

```text
/automod exempt-role rule:RULE_ID target:ROLE
/automod unexempt-role rule:RULE_ID target:ROLE
/automod exempt-channel rule:RULE_ID target:CHANNEL
/automod unexempt-channel rule:RULE_ID target:CHANNEL
```

Role exemptions have a maximum of 20; channel exemptions have a maximum of 50. Additions verify that targets belong to this server. Latch refuses an everyone-role exemption. Removing a reference does not require the target to still exist, allowing cleanup after deletion. Repeating an existing addition/removal sends no update.

Operations serialize within this process and re-read the rule before each edit, preserving other local concurrent additions. Other bots or manual Discord edits can still race read/modify/write. Run one Latch process per server and inspect configuration after concurrent external edits.

## Allowed words and block explanations

```text
/automod allow-words rule:RULE_ID words:allowed phrase,another phrase
/automod allow-words rule:RULE_ID
/automod block-message rule:RULE_ID message:Please follow the community rules.
```

Allowed words replace the current exception list on keyword or preset rules; omitting words clears it. Latch accepts up to 100 comma-separated entries of 60 characters each, removes duplicates and preserves other trigger metadata, including existing regex patterns. The bot does not validate or author Rust regex patterns.

Block explanations accept 1-150 characters and require an existing message-blocking action. Other actions and their metadata are retained. Use `/automod policy` to configure blocking, alert and timeout combinations. See [action policies and filter editing](AUTOMOD-POLICIES.md) for limits, permissions and alert privacy.

These configuration commands preserve the enabled state. Editing an enabled rule takes effect in Discord without a separate enable command. Use `disable` before configuring a rule if staff need a review period. `remove` permanently deletes the native rule.

## Upgrade and first policy

Back up the existing installation before upgrading. Keep the existing `.env` and data files private and preserve their paths. After installing this version, run:

```sh
npm run doctor
npm run register
npm run doctor:live
```

Restart the bot. The new commands will appear after registration; no local AutoMod data migration is needed. Existing native rules stay in Discord.

Create a disabled rule, copy its ID from the private response, then configure and inspect it:

```text
/automod keywords name:Link safety keywords:*scam*
/automod block-message rule:RULE_ID message:Please follow the community rules.
/automod policy rule:RULE_ID mode:block-alert channel:STAFF_CHANNEL
/automod info rule:RULE_ID
/automod enable rule:RULE_ID
```

Choose the actual ID and channel using Discord's command inputs. An alert logs matching user content in the selected channel. Test with a non-exempt member in a non-exempt test channel. Disable the rule immediately if it blocks legitimate messages, adjust keywords or allowed words, inspect again and re-enable after review. Use a keyword or mention rule and add `seconds` for timeout modes; both staff and bot need Moderate Members.

## Recovery and verification

No local schema migration is needed; run `npm run register` after upgrading. API failures receive a private generic error without provider response bodies or credentials. A lost creation response can leave a disabled rule without confirmation: run `list` before creating another. Configuration has no durable local receipt ledger; re-read with `info` after a lost response.

Rule inspection is capped to the Discord message limit, so very large existing configurations can be truncated. Use Discord Server Settings for a full inspection. Automated tests cover presets, targets, ownership, caps, concurrency and configuration preservation using a simulated adapter. Actual Discord filtering and permissions remain unverified.

API choices and limits were checked against the [official Discord AutoMod reference](https://docs.discord.com/developers/resources/auto-moderation) on October 10, 2026. Broader competitor parity remains unfinished.
