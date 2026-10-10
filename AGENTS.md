# Publication text

The owner requires no em dash characters (U+2014) in their GitHub profile or in any release title, notes or asset metadata. Use a hyphen, colon or separate sentence instead.

Keep README, changelog and public documentation free of that character too. Run `npm run publication-check` before publishing. Pass the exact profile README and release-notes draft paths to `npm run publication-check -- <paths>` before writing them to GitHub. Inspect a proposed release title and asset metadata as well. Verify the published text after writing it.
