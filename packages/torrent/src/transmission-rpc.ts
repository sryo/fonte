// ── Transmission RPC Client ───────────────────────────────────────────────────

interface TransmissionRpcResponse {
    result: string;
    arguments?: any;
    tag?: number;
}

export class TransmissionRpc {
    private url: string;
    private sessionId = '';

    constructor(host = '127.0.0.1', port = 9091) {
        this.url = `http://${host}:${port}/transmission/rpc`;
    }

    async call(method: string, args?: Record<string, any>): Promise<any> {
        if (!this.sessionId) {
            await this.acquireSessionId();
        }

        try {
            return await this.doCall(method, args);
        } catch (err) {
            // Session may have expired — reacquire and retry once
            if ((err as Error).message.includes('409') || (err as Error).message.includes('fetch failed')) {
                await this.acquireSessionId();
                return await this.doCall(method, args);
            }
            throw err;
        }
    }

    private async acquireSessionId(): Promise<void> {
        // Send a minimal request to get the 409 + session header
        try {
            const res = await fetch(this.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{"method":"session-get"}',
                signal: AbortSignal.timeout(5000),
            });
            if (res.status === 409) {
                this.sessionId = res.headers.get('x-transmission-session-id') || '';
                await res.text(); // drain response body
            } else if (res.ok) {
                // Already had a valid session somehow
                this.sessionId = res.headers.get('x-transmission-session-id') || this.sessionId;
                await res.text();
            }
        } catch {
            // Transmission not reachable
        }
    }

    private async doCall(method: string, args?: Record<string, any>): Promise<any> {
        const res = await fetch(this.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Transmission-Session-Id': this.sessionId,
            },
            body: JSON.stringify({ method, arguments: args }),
            signal: AbortSignal.timeout(15000),
        });

        if (res.status === 409) {
            this.sessionId = res.headers.get('x-transmission-session-id') || '';
            await res.text();
            throw new Error('Transmission RPC: 409 session expired');
        }

        if (!res.ok) {
            throw new Error(`Transmission RPC error (${res.status})`);
        }

        const data = await res.json() as TransmissionRpcResponse;
        if (data.result !== 'success') {
            throw new Error(`Transmission RPC: ${data.result}`);
        }
        return data.arguments;
    }

    async isAvailable(): Promise<boolean> {
        try {
            await this.call('session-get');
            return true;
        } catch {
            return false;
        }
    }
}
