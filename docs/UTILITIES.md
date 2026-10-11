# Information and utility commands

All utility responses are private to the person running the command. They work in the configured server without requiring staff permissions. The information commands read Discord metadata and do not change members, roles, emojis or stickers.

## Profiles and server information

| Command | Behavior |
| --- | --- |
| `/utility banner [user] [profile]` | Shows a current member's server banner, falling back to their global banner. Choose the global profile explicitly to skip the server banner. Defaults to yourself. |
| `/utility servericon` | Shows the server icon and an original image link. |
| `/utility serverbanner` | Shows the server banner and an original image link. |
| `/utility boosts` | Shows the current boost level and total number of boosts. It does not enumerate individual boosters. |
| `/utility roles [page]` | Lists roles by descending position, 15 per page. Use `/utility role` for permission metadata. |
| `/utility emojis [page]` | Lists custom server emoji names, IDs and animation status, 15 per page. |
| `/utility emoji id` | Shows one server emoji and a link to its original asset. |
| `/utility stickers [page]` | Lists custom server sticker names, IDs and formats, 15 per page. |
| `/utility sticker id` | Shows a server sticker and its asset link. Lottie stickers have a JSON link instead of an unsupported image embed. |

Missing artwork and empty inventories have normal empty-state responses. Invalid IDs, foreign-server metadata and failed API requests receive a private error without exposing tokens or raw API responses. Lists have bounded output and explicit page counts. These commands do not enumerate private channels or fetch message history.

## Local tools

These commands do not make Discord API requests beyond returning the interaction response.

| Command | Example and limits |
| --- | --- |
| `/utility snowflake id` | Decodes a decimal Discord ID into its UTC creation time and worker/process/increment fields. Uses exact 64-bit arithmetic. Decoding does not prove that an object exists. |
| `/utility timestamp [seconds] [style]` | Creates copyable `<t:...>` markup. Omit seconds for the current time. Seven Discord display styles are available. Input is Unix seconds, not milliseconds; UTC is shown separately. |
| `/utility color hex` | `#4a90d9` or `abc` returns the expanded hex value, RGB channels, decimal value and an embed color sample. |
| `/utility calculate expression` | `(120 + 30) / 5` returns 30. Supports `+ - * / % ^`, parentheses, decimals, signs and scientific notation. `^` means exponentiation and `%` means remainder. |

The calculator uses floating-point arithmetic and an independent parser. Powers associate from the right: `2^3^2` is 512. Powers precede a leading sign: `-2^2` is -4. Inputs are limited to 200 characters, 100 tokens and 16 nested parenthesis levels. Non-finite results and magnitudes above `1e100` are rejected. No arbitrary code, functions, variables or network lookups are evaluated.

## Upgrade and verification

After upgrading, run `npm run register`, then `npm run doctor:live -- --json` with your own configured environment. Registration updates command definitions in Discord; the doctor compares them with the local source.

Automated checks cover the real interaction router with simulated Discord responses, numeric boundaries, asset formats, invalid API payloads, pagination, foreign-server rejection and secret-safe failures. The release smoke check sends signed HTTP interactions for the calculator and server icon through the running application. These checks do not establish live Discord acceptance or full competitor parity.

API references: [Discord guilds](https://docs.discord.com/developers/resources/guild), [emoji](https://docs.discord.com/developers/resources/emoji), [stickers](https://docs.discord.com/developers/resources/sticker), and [CDN formats and snowflakes](https://docs.discord.com/developers/reference).
