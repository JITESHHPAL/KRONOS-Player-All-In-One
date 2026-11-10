# Contributing to KRONOS

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Getting started

```bash
git clone https://github.com/JITESHHPAL/KRONOS-PLAYER-All-In-One.git
cd KRONOS-PLAYER-All-In-One
python server.py        # then open http://localhost:8000
```

There is **no build step and no dependencies**: the server uses only the Python standard library and the web player is plain HTML, CSS and JavaScript. ffmpeg is optional but needed to try audio/quality switching.

## Before you open a pull request

1. Create a branch: `git checkout -b feat/my-change`
2. Run the tests: `python -m unittest discover -s tests -v`
3. Check the JavaScript syntax: `node --check web/player.js && node --check web/media.js`
4. Try your change in a browser (ideally also on a phone)
5. Update `README.md` and `CHANGELOG.md` if behaviour changes

## Guidelines

- Keep it dependency-free; discuss in an issue first if you think one is needed
- Keep playback light: avoid adding blur or heavy animations to elements that sit over a playing video
- Never read or serve files outside the library folder; add a test for server changes
- Follow `.editorconfig` (UTF-8, LF, 2 spaces; 4 for Python)
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`

## Reporting bugs

Use the **Bug report** issue form and include your browser, device, KRONOS version (`python server.py --version`) and the file format if it is about playback.

By contributing you agree that your work is released under the [MIT License](LICENSE).
