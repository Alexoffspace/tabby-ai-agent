# Tabby AI Agent

![Tabby AI Agent screenshot](screenshot.png)

Tabby AI Agent adds an AI assistant panel directly inside [Tabby](https://tabby.sh/). It helps you understand terminal output, ask follow-up questions, and review suggested commands without leaving your active terminal tab.

The plugin is designed for users who want AI help in the terminal while keeping command execution visible and reviewable.

## What it does

- Adds an **AI Chat** side panel to terminal tabs.
- Lets you ask questions about what is happening in the current terminal.
- Can read recent terminal output when it needs context.
- Can suggest and run shell commands in the active terminal.
- Shows each proposed command before it runs, including the command text, risk level, explanation, and estimated runtime.
- Supports manual approval for commands, with an option to automatically approve low-risk commands.
- Connects to OpenAI-compatible chat endpoints, including local or self-hosted services.
- Supports extra model request parameters for providers such as LiteLLM, llama.cpp, vLLM, and similar services.

## Why use it

Tabby AI Agent is useful when you want help with everyday terminal work:

- Understanding errors and command output.
- Asking what to do next.
- Reviewing logs.
- Getting command suggestions.
- Running inspection commands with confirmation.
- Working with local or self-hosted AI endpoints instead of sending terminal context to a public service.

## Opening the AI panel

After the plugin is enabled, open the AI Agent panel from a terminal tab using the **Open AI Agent** button.

You can also toggle the panel with the keyboard shortcut:

- **Windows and Linux:** `Ctrl+Shift+B`
- **macOS:** `Cmd+Shift+B`

## Settings

Open Tabby's settings and choose **AI Agent**.

### LLM endpoint

Enter the base URL for your OpenAI-compatible chat API.

Use only the base URL. The plugin automatically sends chat requests to `/v1/chat/completions`.

Example:

```text
http://127.0.0.1:4000
```

Do not include the full chat completions path.

### Command approval

When the assistant wants to run a shell command, the plugin shows a command review card first. The card includes:

- The exact command.
- A risk level.
- A plain-language explanation.
- An estimated runtime.
- **Approve** and **Decline** actions.

You can enable **Auto approve low risk commands** for faster workflows. Medium and high risk commands still require manual approval.

### Additional request parameters

Advanced users can add extra JSON request parameters for their model provider. This can be useful for model-specific settings such as temperature, top-p, reasoning options, or chat template options.

Leave this field empty if you do not need custom model settings.

## Privacy and control

The assistant can use terminal context to answer questions and help with commands. The destination depends on the LLM endpoint you configure.

If you use a local or self-hosted OpenAI-compatible endpoint, terminal context is sent to that endpoint instead of a public cloud service.

Commands are not silently hidden from you. When command approval is required, the plugin shows what will run before it is sent to the terminal.

## License

MIT
