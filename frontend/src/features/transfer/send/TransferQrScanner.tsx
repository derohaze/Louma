import { useEffect, useRef, useState } from "react";
import {
  CheckmarkCircle01Icon,
  ImageUpload01Icon,
  QrCodeScanIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/page";
import { normalizeTransferTarget } from "@/shared/lib/platform";
import { cn } from "@/shared/lib/platform";

/**
 * The three stages of a send, in the order the wallet asks for them. Each stage is one question, and
 * the card holds one at a time: an address that does not resolve never reaches the amount, and an
 * amount the ledger refuses never reaches the confirmation.
 */
const sendSteps = [
  { id: 1, label: "Address" },
  { id: 2, label: "Amount" },
  { id: 3, label: "Confirm" },
] as const;

export function SendStepper({ stage }: { stage: 1 | 2 | 3 }) {
  return (
    <ol className="mb-5 flex items-center gap-3">
      {sendSteps.map((step, index) => {
        const done = stage > step.id;
        const current = stage === step.id;
        return (
          <li key={step.id} className="flex flex-1 items-center gap-2">
            <span
              aria-current={current ? "step" : undefined}
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                done
                  ? "border-success/40 bg-success/10 text-success"
                  : current
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary text-muted-foreground",
              )}
            >
              {done ? <Icon icon={CheckmarkCircle01Icon} size={16} /> : step.id}
            </span>
            <span
              className={cn(
                "text-xs font-semibold",
                current ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {index < sendSteps.length - 1 && <span aria-hidden className="h-px flex-1 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Pulls a transfer target out of decoded QR text, which may carry a prefix or URL. */
function targetFromQrText(text: string): string | null {
  const match = /(LMA(?:-[A-Z0-9]{4}){3}|@[a-z0-9_]{4,24})/i.exec(text);
  return match?.[1] ? normalizeTransferTarget(match[1]) : null;
}

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

/**
 * Inline QR reader for the send form: live camera when the browser can decode
 * frames, image upload otherwise. Stays in context (no modal) so a failed
 * scan leaves the typed address untouched.
 */
export function QrScanner({ onDetected }: { onDetected: (address: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);
  const [cameraError, setCameraError] = useState("");
  const [working, setWorking] = useState(false);

  const detectorSupported = typeof window !== "undefined" && "BarcodeDetector" in window;

  const stop = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };
  useEffect(() => stop, []);

  const scanFrame = async (detector: BarcodeDetectorLike) => {
    const video = videoRef.current;
    if (!video || doneRef.current) return;
    try {
      const codes = await detector.detect(video);
      const found = codes
        .map((code) => code.rawValue ?? "")
        .map(targetFromQrText)
        .find(Boolean);
      if (found) {
        doneRef.current = true;
        setWorking(false);
        onDetected(found);
        stop();
        return;
      }
    } catch {
      // A single bad frame must not kill the loop; the next one may decode.
    }
    rafRef.current = requestAnimationFrame(() => void scanFrame(detector));
  };

  const startCamera = async () => {
    setCameraError("");
    if (!detectorSupported) {
      setCameraError("This browser cannot read QR codes from the camera. Upload an image instead.");
      return;
    }
    doneRef.current = false;
    setWorking(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video || doneRef.current) {
        // The scanner was hidden while permission was pending: unmount cleanup ran before a
        // stream existed, so the grant arriving now must release its tracks immediately
        // instead of leaving the camera active with no video element.
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) streamRef.current = null;
        setWorking(false);
        return;
      }
      video.srcObject = stream;
      await video.play();
      const Detector = (
        window as unknown as { BarcodeDetector: new (o: object) => BarcodeDetectorLike }
      ).BarcodeDetector;
      void scanFrame(new Detector({ formats: ["qr_code"] }));
    } catch {
      setWorking(false);
      setCameraError("The camera could not be opened. Check permission, or upload an image.");
    }
  };

  const scanImage = async (file: File) => {
    setCameraError("");
    if (!detectorSupported) {
      setCameraError("This browser cannot read QR codes. Paste the address instead.");
      return;
    }
    setWorking(true);
    try {
      const bitmap = await createImageBitmap(file);
      const Detector = (
        window as unknown as { BarcodeDetector: new (o: object) => BarcodeDetectorLike }
      ).BarcodeDetector;
      const codes = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
      const found = codes
        .map((code) => code.rawValue ?? "")
        .map(targetFromQrText)
        .find(Boolean);
      if (found) onDetected(found);
      else setCameraError("No wallet address was found in that image.");
    } catch {
      setCameraError("That image could not be read. Try a clearer one.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="rounded-xl border bg-secondary/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void startCamera()}
          disabled={working}
        >
          <Icon icon={QrCodeScanIcon} size={17} />
          {working ? "Scanning…" : "Scan with camera"}
        </Button>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-4 text-xs font-semibold">
          <Icon icon={ImageUpload01Icon} size={16} />
          Upload QR image
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void scanImage(file);
            }}
          />
        </label>
      </div>
      <video
        ref={videoRef}
        muted
        playsInline
        className="mt-3 w-full rounded-xl bg-black"
        aria-label="QR scanner preview"
      />
      {cameraError && <p className="mt-2 text-xs text-destructive">{cameraError}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        Point at a Louma receive QR. Nothing is filled in until an address is recognised.
      </p>
    </div>
  );
}
