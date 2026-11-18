const REFRESH_REQUIRED = { error: 'Kibitz was reloaded. Refresh this chess tab to reconnect.' };

/** Chrome can invalidate a content script while its page and timers remain alive. */
export class ContentRuntime {
    private invalidated = false;
    private dispose?: () => void;

    get available(): boolean {
        if (this.invalidated) return false;
        try { if (chrome.runtime?.id) return true; } catch { /* Unloaded extension. */ }
        this.invalidate();
        return false;
    }

    onInvalidated(dispose: () => void) {
        this.dispose = dispose;
        if (this.invalidated) dispose();
    }

    async send(message: object): Promise<any> {
        if (!this.available) return REFRESH_REQUIRED;
        try {
            return await chrome.runtime.sendMessage(message);
        } catch (error) {
            // A synchronous sendMessage throw also enters this catch. Other
            // connection failures may be transient and do not retire the script.
            if (!this.available || error instanceof Error && error.message.includes('Extension context invalidated')) {
                this.invalidate();
                return REFRESH_REQUIRED;
            }
            return { error: 'Kibitz could not connect. Try again or refresh this chess tab.' };
        }
    }

    private invalidate() {
        if (this.invalidated) return;
        this.invalidated = true;
        this.dispose?.();
    }
}
