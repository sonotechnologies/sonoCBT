/**
 * Identity photo from the front camera: 320×240 JPEG (~15 KB). Loaded only for
 * exams that take photos, so it adds nothing to other exams' download.
 */
export async function capturePhoto(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: "user" }, audio: false });
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // Give the camera a moment to set its exposure.
    await new Promise((r) => setTimeout(r, 600));
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    canvas.getContext("2d")!.drawImage(video, 0, 0, 320, 240);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.6));
    if (!blob) throw new Error("No photo");
    return blob;
  } finally {
    for (const t of stream.getTracks()) t.stop();
  }
}

export async function sendPhoto(url: string, blob: Blob): Promise<void> {
  await fetch(url, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
}
