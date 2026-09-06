# Flathub submission checklist

The first attempt ([flathub/flathub#10103](https://github.com/flathub/flathub/pull/10103))
was closed. Two reasons, both from the reviewer:

> The PR is obviously AI-generated, and this goes against the rules.

> The manifest itself looks like AI-generated as well.

Both point at the [Generative AI policy][ai]. Work through everything below
before opening another one.

---

## 1. The AI rules — read these first

The policy has two halves and they are different:

| | |
|---|---|
| **Must disclose** | AI-generated code, documentation, packaging, or other material in the app *or* its Flathub packaging |
| **Must not do at all** | Use AI tools to automate the submission PR, its review interactions, or to generate commit messages |

Undisclosed AI material can mean a **permanent ban**, not just a rejection.

- [ ] Read [the policy][ai] in full, not this summary.
- [ ] **Write the PR body yourself.** Not edited from a draft. Yourself.
- [ ] **Write the commit message yourself.**
- [ ] **Reply to reviewers yourself.** Review interactions are covered too.
- [ ] Fill the disclosure box with real numbers. From `git log` today:
      126 of 313 commits carry a Claude co-author trailer, 36 more are authored
      by it directly, 18 are from a Copilot agent, and the Flatpak packaging
      (manifest, `cargo-sources.json`, the Background-portal autostart) was
      AI-written. Check these before quoting them:

      ```
      git rev-list --count HEAD
      git log --format=%b | grep -c "Co-Authored-By: Claude"
      git shortlog -sn --all
      ```

- [ ] Own the manifest. Read every line; if you cannot say why it is there,
      delete it or find out. Cut the long explanatory comments down to what a
      reviewer needs — real manifests carry a handful of short notes, not
      paragraphs of rationale. That prose is what made this one *look*
      generated, and disclosure alone will not fix how it reads.

---

## 2. Development history

> Submissions must demonstrate a meaningful history of development or existence,
> evidence of real-world use and a clear commitment to ongoing maintenance.
> [...] Very new applications are generally rejected.

This is the item most likely to sink a resubmission. Today: first commit
2026-07-16, 1.0.0 two days ago, 2 stars, no external contributors.

- [ ] Decide honestly whether to submit now or wait. Waiting costs nothing;
      a second rejection on the same PR history costs goodwill.
- [ ] If waiting: accumulate real-world use first. Issues from strangers,
      a few releases over a few months, evidence somebody other than you runs it.

---

## 3. Technical gaps in the manifest — fixed

All three were found by checking the manifest against the written rules, not by
the reviewer, and all three are done. Verify them if you change anything.

- [x] **Licence path.** Was `/app/share/licenses/pc-gamepak/LICENSE`; the rule
      is `$FLATPAK_DEST/share/licenses/$FLATPAK_ID/`. Now installs to
      `/app/share/licenses/io.github.HarryBMa.PCGamePak/LICENSE`.

- [x] **Icon size.** The rule is an SVG or a 256×256 PNG; only 128×128 and
      32×32 were installed. `icons/icon.svg` (512 viewBox) now goes to
      `hicolor/scalable/`, and `128x128@2x.png` (genuinely 256×256) to
      `hicolor/256x256/`. The two small rasters stay as fallbacks.

- [x] **Screenshots.** There was no `<screenshots>` element at all, so the
      store page would have been blank. Four now, pinned to
      `raw.githubusercontent.com/.../v1.0.1/docs/` so the URLs cannot move when
      `main` does. All four return 200 — re-check if you re-tag:

      ```
      curl -sIL -o /dev/null -w "%{http_code}" \n        https://raw.githubusercontent.com/HarryBMa/pc-gamepak/v1.0.1/docs/launcher.png
      ```

Already correct, do not re-litigate:

- App ID is reverse-DNS, lowercase domain part, matches `<id>` in the MetaInfo.
- YAML is 2-space indented throughout.
- `.desktop` file present, `Icon=` matches the app ID.
- `<launchable>`, `<project_license>`, `<developer>`, `<content_rating>`,
  homepage/bugtracker/vcs URLs all present.
- Source is a pinned `tag` + `commit`, no binaries, all crates vendored.

---

## 4. Permissions — expect to defend these

The rule is *minimal static permissions, and XDG Portals wherever a suitable
alternative exists*. Four will be questioned:

| Permission | The argument |
|---|---|
| `--filesystem=/run/media`, `/media`, `/mnt` | The app reads cartridges that udisks mounts there. These are mount points, not `$HOME`. There is no portal for "watch for a drive appearing" |
| `--talk-name=…portal.OpenURI` | Already a portal. Nothing runs in the sandbox |
| `--talk-name=…portal.Background` | Already a portal. Only route to autostart without a systemd unit |
| `--share=network` | Optional SteamGridDB artwork lookup in the wizard, off until the user supplies a key. The launcher needs no network |

- [ ] Be ready to justify each in your own words, briefly.
- [ ] Drop `--share=network` if you would rather not argue it — the wizard is
      the only thing that uses it, and it degrades to "no artwork lookup".

---

## 5. The submission itself

- [ ] Record a video of the app running **as a Flatpak on Linux**. Required by
      the checklist, and it is also the strongest possible answer to "is this
      real software". Plugging in a cartridge and pressing Play is a good 20
      seconds.
- [ ] Fork `flathub/flathub`, branch from **`new-pr`**, add
      `io.github.HarryBMa.PCGamePak.yml` and `cargo-sources.json` at the root.
- [ ] Base the PR against **`new-pr`**, not `master`.
- [ ] Complete every checklist box in the template. The bot closes PRs with an
      incomplete checklist within the hour, before a human sees it.
- [ ] Tick the "I am the author" line and leave the upstream-contact link blank
      or `N/A — I am the author`.

---

## 6. Before you push

- [ ] `flatpak run org.flatpak.Builder --force-clean --install builddir <manifest>`
      still succeeds after the fixes in §3.
- [ ] `appstreamcli validate` passes on the MetaInfo, including the screenshots.
- [ ] The tag the manifest names contains `packaging/flatpak/`.
      `v1.0.0` did not; `v1.0.1` does. Check again if you cut a new tag.
- [ ] The pinned `commit` matches the tag: `git rev-list -n1 v1.0.1`.

[ai]: https://docs.flathub.org/docs/for-app-authors/requirements#generative-ai-policy
