# droplol

> **[wrtc](https://github.com/node-webrtc/node-webrtc) takes a while to get updated to the latest node.js version.**
>
> **Usage of LTS versions of node.js is recommended with this package.**

[drop.lol](https://drop.lol) CLI client.

<p align="center">
  <img src="https://raw.githubusercontent.com/mat-sz/droplol/master/droplol.gif" alt="Screenshot">
</p>

See: [filedrop-web](https://github.com/mat-sz/filedrop-web) and [filedrop-ws](https://github.com/mat-sz/filedrop-ws) for more information regarding this project.

**Quickstart:**

```sh
npx droplol ./file.txt
# or, if you only want to receive files:
npx droplol
```

## Usage

```
Usage: npx droplol [file] [-n network]
  --help, -h     prints help
  --network, -n  sets network name
When file is provided, the file is sent and then the program exits.
When no file is provided, the program will receive all files and
save them in the current directory.
```

When installed globally (`npm install -g droplol`) the command is available as `drop`.
