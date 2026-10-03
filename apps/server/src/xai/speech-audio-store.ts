/** Prepared MP3 (or other) bytes for a scheduler speech item, fetched by the web client. */
export class SpeechAudioStore {
  private readonly bytes = new Map<string, Uint8Array>();

  put(itemId: string, audio: Uint8Array): void {
    this.bytes.set(itemId, audio);
  }

  get(itemId: string): Uint8Array | undefined {
    return this.bytes.get(itemId);
  }
}
