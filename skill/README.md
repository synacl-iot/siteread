# seo-read

A Claude Code skill: give it a Google Search Console export and your access log, and it writes a
dated weekly memo (who read the site, whether it went well, what to do next) into
`siteread-log.md`. The numbers come from `npx siteread digest` (zero dependencies, runs locally);
Claude writes the prose.

## Install

```sh
mkdir -p ~/.claude/skills && cp -r skill/seo-read ~/.claude/skills/
```

Then, in the folder where you keep the export and logs, ask Claude Code for "my weekly seo read".
