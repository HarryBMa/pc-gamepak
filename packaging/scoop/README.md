# Scoop packaging

`pc-gamepak.json` is the manifest. Scoop installs from **buckets**, which are
git repositories full of manifests, so publishing means putting this file in one.

## Verified

This manifest was installed on a real machine from the published v0.1.0 release
before being committed:

```
Downloading .../pc-gamepak-0.1.0-windows-x86_64.zip (3.2 MB)...
Checking hash of pc-gamepak-0.1.0-windows-x86_64.zip ... ok.
Extracting pc-gamepak-0.1.0-windows-x86_64.zip ... done.
'pc-gamepak' (0.1.0) was installed successfully!
```

`extract_dir` strips the version folder, so both executables land at the app
root and both get shims. `windows\install.ps1` comes along with them, which is
what the notes point at.

## Publishing it

Scoop's main bucket only takes widely-used software, so this goes in a personal
bucket. That is an ordinary public repository whose name starts with
`scoop-`, containing a `bucket/` directory:

```
scoop-bucket/
└── bucket/
    └── pc-gamepak.json
```

One-time setup:

```powershell
gh repo create HarryBMa/scoop-bucket --public --clone
cd scoop-bucket
mkdir bucket
copy ..\pc-gamepak\packaging\scoop\pc-gamepak.json bucket\
git add . && git commit -m "Add pc-gamepak" && git push
```

Users then install with:

```powershell
scoop bucket add harrybma https://github.com/HarryBMa/scoop-bucket
scoop install pc-gamepak
```

## Keeping it current

`checkver` and `autoupdate` are already configured, so the bucket updates
itself once the excavator runs against it — no manual hash editing per release.
`autoupdate.hash.url` reads the `.sha256` file the release workflow uploads
beside the zip.

To do it by hand from a clone of the bucket:

```powershell
.\bin\checkver.ps1 -App pc-gamepak -Update
```

Adding `.github/workflows/excavator.yml` from
[ScoopInstaller/GithubActions](https://github.com/ScoopInstaller/GithubActions)
automates that on a schedule.

## What Scoop cannot do

Register the watcher's logon task — it runs no install scripts. So a Scoop
install gives a working wizard immediately and a launcher that will not open on
insert until the user runs `windows\install.ps1 -Mode Watcher` once. The notes
in the manifest say so, and `$dir` resolves to the real path when Scoop prints
them.
