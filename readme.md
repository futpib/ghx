# ghx

> `gh` wrapper that automatically switches GitHub accounts based on the current repository's remote

## Install

```
npm install -g ghx
```

## Usage

Use `ghx` as a drop-in replacement for `gh`. It reads a config file to determine which GitHub account to use based on the git remote host, switches to that account, and forwards all arguments to `gh`.

```
ghx pr list
ghx issue create
ghx repo view
```

## Configuration

Create a config file at `~/.config/ghx/config.json`:

```json
{
  "accounts": {
    "github.com": "your-username",
    "github.com-work": "your-work-username"
  }
}
```

The keys are remote hosts (as they appear in your git remote URLs) and the values are the `gh` account names to switch to.

## Concurrency

When an account switch is needed, `ghx` acquires a file lock at `~/.local/share/ghx/` to prevent parallel instances from racing on the global `gh` active account. The lock is held for the duration of the account switch and `gh` command execution.
