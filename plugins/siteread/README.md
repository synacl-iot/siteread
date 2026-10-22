# seo-read

A Claude Code skill: give it a Google Search Console export and your access log, and it writes a
dated weekly memo (who read the site, whether it went well, what to do next) into
`siteread-log.md`. The numbers come from `npx siteread digest` (zero dependencies, runs locally);
Claude writes the prose. At the end it offers to share the week's totals with the siteread.dev
benchmark, and sends nothing without a yes.

## Install

It ships as the `siteread` plugin; this repo is its marketplace:

```sh
claude plugin marketplace add synacl-iot/siteread
claude plugin install siteread@siteread
```

Or inside Claude Code: `/plugin marketplace add synacl-iot/siteread`, then
`/plugin install siteread@siteread`. Then, in the folder where you keep the export and logs, ask
for "my weekly seo read", or run `/siteread:seo-read`.

Without the plugin system, copy the skill itself:
`mkdir -p ~/.claude/skills && cp -r plugins/siteread/skills/seo-read ~/.claude/skills/`.
