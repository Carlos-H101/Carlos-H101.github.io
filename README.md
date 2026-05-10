# Carlos Hernandez — Portfolio

Personal portfolio site. Single-page HTML/CSS/JS, hosted via GitHub Pages.

**Live:** https://carlos-h101.github.io

## Structure

```
.
├── index.html              ← main portfolio page
├── awards/                 ← per-award detail pages (linked from hex modal)
│   ├── award.css
│   ├── miners-pitch.html
│   ├── pioneers-21.html
│   ├── miner-tank.html
│   └── dell-tech.html
├── Worthy Images/          ← all photos and project videos
└── README.md
```

## Local preview

Open `index.html` in any browser, or run a tiny local server:

```sh
cd Portfolio
python -m http.server 8080
# then visit http://localhost:8080
```

## Deploy

Pushing to `main` automatically updates the live site (GitHub Pages is enabled
on the `Carlos-H101.github.io` repo).
