import { useId, useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2, QrCode, UserPlus } from "lucide-react";
import { QRScanner } from "@/components/QRScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/i18n/I18nContext";
import befCircleText from "@/i18n/modules/befCircle";

/**
 * The field a card is added with: its private key (WIF) typed or pasted, its
 * QR code scanned, or a person's Nostr hex id typed. Ported from bef-explorer
 * src/components/person/KeyField.tsx, with MejmoSefajn's own QR scanner.
 *
 * The text is taken out of the field BEFORE it is read — whether reading then
 * works or not — so a card's key never stays on screen or in this component's
 * state, and a typo is typed again rather than fixed in place. The scanner hands
 * what it decoded straight to `onSubmit` and never into the field. The field is
 * a password field by default, and autocomplete and the password managers'
 * markers are off: a WIF is a money key and must not end up in a synced vault.
 */
export function CardAddBox({
  busy,
  busyLabel,
  problem,
  onSubmit,
}: {
  busy: boolean;
  busyLabel: string;
  /** Already in words; never contains what was typed. */
  problem: string | null;
  /** The text typed or scanned — the field is already empty when this runs. */
  onSubmit: (input: string) => void;
}) {
  const { t } = useTranslation(befCircleText);
  const id = useId();
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [scanning, setScanning] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !value.trim()) return;
    const input = value;
    setValue("");
    setReveal(false);
    onSubmit(input);
  };

  return (
    <>
      <form onSubmit={submit} autoComplete="off" noValidate className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-card`}>{t("cards.add.keyLabel")}</Label>
          <div className="flex gap-2">
            <Input
              id={`${id}-card`}
              type={reveal ? "text" : "password"}
              name="bef-card-key"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              placeholder={t("cards.add.placeholder")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={busy}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-problem` : undefined}
              className="font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => setReveal((v) => !v)}
              aria-pressed={reveal}
              aria-label={reveal ? t("circle.add.hideLabel") : t("circle.add.showLabel")}
              title={reveal ? t("circle.add.hide") : t("circle.add.show")}
            >
              {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {problem && (
          <p id={`${id}-problem`} role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="submit" disabled={busy || !value.trim()} className="sm:flex-1">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
            {busy ? busyLabel : t("cards.add.submit")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setScanning(true)} disabled={busy}>
            <QrCode className="mr-2 h-4 w-4" />
            {t("circle.add.scan")}
          </Button>
        </div>
      </form>

      <QRScanner
        isOpen={scanning}
        onClose={() => setScanning(false)}
        onScan={(data) => {
          setScanning(false);
          onSubmit(data);
        }}
        title={t("circle.scan.title")}
        description={t("circle.scan.description")}
      />
    </>
  );
}
