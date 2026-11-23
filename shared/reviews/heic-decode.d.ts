/** heic-decode (https://github.com/catdad-experiments/heic-decode) は型を同梱していない。使う所だけを書く */
declare module 'heic-decode' {
  type DecodedImage = { width: number; height: number; data: Uint8ClampedArray };
  type PendingImage = { width: number; height: number; decode(): Promise<DecodedImage> };
  function decode(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<DecodedImage>;
  namespace decode {
    /** 中の画像を、寸法だけ読んだ状態で返す (decode で画素を読む)。使い終わったら dispose を呼ぶ */
    function all(input: {
      buffer: ArrayBufferLike | Uint8Array;
    }): Promise<PendingImage[] & { dispose(): void }>;
  }
  export default decode;
}
