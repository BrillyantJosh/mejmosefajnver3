import { useId, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Globe, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useLang, useTranslation } from "@/i18n/I18nContext";
import befText from "@/i18n/modules/befText";
import { BefApiError } from "@/lib/bef/api";
import { doorProblem, registrationProblem, type BefProblem, type BefTextKey } from "@/lib/bef/problems";
import { BefKeyError } from "@/lib/bef/signing";
import { callingCode } from "@/lib/bef/vendor/src/lib/callingCodes.ts";
import { isCountryCode } from "@/lib/bef/vendor/server/lib/countries.ts";
import {
  buildProfileContent,
  checkProfileInput,
  PROFILE_STATEMENT,
  type ProfileInputError,
} from "@/lib/bef/vendor/server/lib/personProfile.ts";
import { cn } from "@/lib/utils";
import { useBefPerson, type RegistrationMode } from "@/pages/bef/BefPersonProvider";
import { BefCountryPicker } from "./BefCountryPicker";
import { BEF_LOCALES, BefText } from "./BefText";

/**
 * BEF Explorer's registration card, inside the module: shown when the Lana
 * Registrar does not know the wallet (register, or registerOnly when the key
 * already has a profile — the usual case here, since logging in to MejmoSefajn
 * needs a profile), or when the wallet is this key's but BEF finds no profile
 * (profile).
 *
 * Order, as the owner decided: the wallet is registered at the Registrar FIRST,
 * then the KIND 0 profile is published — BEF enforces it. This card collects
 * the fields, says plainly what becomes public, and on submit signs with the
 * key the person is logged in to MejmoSefajn with: the Registrar consent, the
 * registration sign-in and, when a profile is needed, the KIND 0 built by the
 * vendored personProfile.ts — the code BEF checks it with.
 *
 * Ported from bef-explorer src/components/person/PersonRegistration.tsx. What
 * is left out is only the key field: there is no key to type here.
 */

/** Profile fields BEF may name when it refuses a profile, mapped to the form field that produced them. */
const FIELD_OF: Record<string, ProfileInputError> = {
  name: "first_name",
  display_name: "first_name",
  country: "country",
  currency: "country",
  email: "email",
  phone: "phone",
  phone_country_code: "phone_country_code",
  wallet: "wallet",
};

/** Refusals of the sign-in gate that end the card: the wallet's standing is decided. */
const LEAVING = ["wrong_key", "owner_unknown", "profile_incomplete", "account_changed", "key_unreadable"];

export function BefRegistration({
  mode,
  address,
  interestOpen,
}: {
  mode: RegistrationMode;
  /** The wallet as BEF named it; the profile names the same form. */
  address: string;
  /** Whether any split is open for interest right now (null: not known). */
  interestOpen: boolean | null;
}) {
  const { t } = useTranslation(befText);
  const lang = useLang();
  const { session } = useAuth();
  const { registerWallet, setRegistration, leaveRegistration, retry } = useBefPerson();
  const id = useId();
  const withProfile = mode !== "registerOnly";
  const withRegistration = mode !== "profile";

  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [phoneCode, setPhoneCode] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<BefProblem | null>(null);
  const [serverField, setServerField] = useState<ProfileInputError | null>(null);
  /** The calling code this form filled in itself — replaced when the country
   * changes, while a code the person typed is left alone. */
  const autoCode = useRef("");

  const input = { firstName, surname, country: country ?? "", email, phoneCountryCode: phoneCode, phone, wallet: address };
  const fieldErrors = withProfile ? checkProfileInput(input, isCountryCode) : [];
  const showError = (field: ProfileInputError) => (tried && fieldErrors.includes(field)) || serverField === field;
  const say = (text: BefTextKey) => setProblem({ code: text, text, action: "none" });

  const chooseCountry = (code: string | null) => {
    setCountry(code);
    setServerField(null);
    const suggested = callingCode(code);
    if (suggested && (phoneCode.trim() === "" || phoneCode === autoCode.current)) {
      setPhoneCode(suggested);
      autoCode.current = suggested;
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setProblem(null);
    setServerField(null);
    if (withProfile && (fieldErrors.length > 0 || !accepted)) {
      setTried(true);
      say(fieldErrors.length > 0 ? "person.reg.fixFields" : "person.reg.acceptRequired");
      return;
    }
    setBusy(true);
    try {
      const profile = withProfile ? { firstName, surname, country: country ?? "", email, phoneCountryCode: phoneCode, phone } : null;
      await registerWallet({ address, profile, lang });
    } catch (err) {
      if (err instanceof BefApiError && err.code === "registry_mismatch" && typeof err.body.address === "string") {
        // Registered — under the other form of the same key. The profile must
        // name that form; the fields stay as typed and the next press publishes.
        setRegistration("profile", err.body.address);
        setProblem(registrationProblem(err));
      } else if (err instanceof BefApiError && err.code === "profile_required" && mode === "registerOnly") {
        // The key's profile is gone from the relays in the meantime: ask for one.
        setRegistration("register", address);
        setProblem(registrationProblem(err));
      } else if ((err instanceof BefApiError || err instanceof BefKeyError) && LEAVING.includes(err.code)) {
        leaveRegistration(doorProblem(err));
      } else {
        if (err instanceof BefApiError && err.code === "profile_invalid" && typeof err.body.field === "string") {
          setServerField(FIELD_OF[err.body.field] ?? null);
        }
        setProblem(registrationProblem(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const title: BefTextKey = withRegistration ? "person.reg.titleRegister" : "person.reg.titleProfile";
  const lead: BefTextKey =
    mode === "profile" ? "person.reg.leadProfile" : mode === "registerOnly" ? "person.reg.leadRegisterOnly" : "person.reg.leadRegister";
  const submitLabel: BefTextKey =
    mode === "profile" ? "person.reg.submitProfile" : mode === "registerOnly" ? "person.reg.submitRegisterOnly" : "person.reg.submitRegister";
  // Say only the steps this mode takes: a profile-only card registers nothing,
  // a register-only card publishes nothing.
  const submitting: BefTextKey =
    mode === "profile" ? "person.reg.submittingProfile" : mode === "registerOnly" ? "person.reg.submittingRegisterOnly" : "person.reg.submitting";
  const preview = withProfile ? JSON.stringify(buildProfileContent(input), null, 2) : "";
  const meaning = t("person.reg.statementMeaning");

  const fieldError = (field: ProfileInputError) =>
    showError(field) ? (
      <p className="text-xs text-destructive" id={`${id}-${field}-error`}>
        {t(`person.reg.field.${field}` as BefTextKey)}
      </p>
    ) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
          <ShieldCheck className="h-5 w-5 text-primary" />
          {t(title)}
        </CardTitle>
        <p className="text-sm text-muted-foreground leading-relaxed">{t(lead)}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t("person.reg.wallet")}</span>{" "}
          <code className="break-all font-mono text-xs sm:text-sm">{address}</code>
        </div>

        {withRegistration && <p className="text-xs text-muted-foreground leading-relaxed">{t("person.reg.registrarNote")}</p>}
        <p className="text-xs text-muted-foreground leading-relaxed">{t("reg.signedWithSession")}</p>

        <form onSubmit={submit} noValidate className="space-y-4">
          {withProfile && (
            <>
              {session?.profileName && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{t("reg.replacesProfile")}</AlertDescription>
                </Alert>
              )}

              <Alert>
                <Globe className="h-4 w-4" />
                <AlertDescription>
                  <strong>{t("person.reg.publicTitle")}</strong> {t("person.reg.publicNotice")}
                </AlertDescription>
              </Alert>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-first`}>{t("person.reg.firstName")}</Label>
                  <Input
                    id={`${id}-first`}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    maxLength={60}
                    disabled={busy}
                    aria-invalid={showError("first_name") || undefined}
                    className={cn(showError("first_name") && "border-destructive")}
                  />
                  {fieldError("first_name")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-surname`}>{t("person.reg.surname")}</Label>
                  <Input
                    id={`${id}-surname`}
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    autoComplete="family-name"
                    maxLength={60}
                    disabled={busy}
                    aria-invalid={showError("surname") || undefined}
                    className={cn(showError("surname") && "border-destructive")}
                  />
                  {fieldError("surname")}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${id}-country`}>{t("person.reg.country")}</Label>
                <BefCountryPicker
                  inputId={`${id}-country`}
                  code={country}
                  onChange={chooseCountry}
                  locale={BEF_LOCALES[lang] ?? "en-GB"}
                  placeholder={t("person.reg.countryPlaceholder")}
                  noMatch={(query) => t("person.reg.countryNoMatch", { query })}
                  invalid={showError("country")}
                  disabled={busy}
                />
                {fieldError("country")}
              </div>

              <div className="grid grid-cols-[6.5rem_1fr] gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-code`}>{t("person.reg.phoneCode")}</Label>
                  <Input
                    id={`${id}-code`}
                    inputMode="tel"
                    value={phoneCode}
                    onChange={(e) => setPhoneCode(e.target.value)}
                    placeholder="+386"
                    maxLength={4}
                    disabled={busy}
                    aria-invalid={showError("phone_country_code") || undefined}
                    className={cn(showError("phone_country_code") && "border-destructive")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-phone`}>{t("person.reg.phone")}</Label>
                  <Input
                    id={`${id}-phone`}
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel-national"
                    maxLength={24}
                    disabled={busy}
                    aria-invalid={showError("phone") || undefined}
                    className={cn(showError("phone") && "border-destructive")}
                  />
                </div>
              </div>
              {fieldError("phone_country_code")}
              {fieldError("phone")}
              <p className="text-xs text-muted-foreground">{t("person.reg.phoneHint")}</p>

              <div className="space-y-1.5">
                <Label htmlFor={`${id}-email`}>{t("person.reg.email")}</Label>
                <Input
                  id={`${id}-email`}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  maxLength={254}
                  disabled={busy}
                  aria-invalid={showError("email") || undefined}
                  className={cn(showError("email") && "border-destructive")}
                />
                {fieldError("email")}
              </div>
              {fieldError("wallet")}

              <div className="space-y-2 rounded-xl border border-border p-4">
                <h3 className="font-semibold">{t("person.reg.statementTitle")}</h3>
                <p className="text-xs text-muted-foreground">{t("person.reg.statementLead")}</p>
                <blockquote lang="en" className="border-l-2 border-primary pl-3 text-sm italic">
                  {PROFILE_STATEMENT}
                </blockquote>
                {meaning !== PROFILE_STATEMENT && <p className="text-sm text-muted-foreground">{meaning}</p>}
                <label className="flex items-start gap-2 pt-1 text-sm">
                  <Checkbox checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} disabled={busy} className="mt-0.5" />
                  <span>{t("person.reg.statementAccept")}</span>
                </label>
                {tried && !accepted && <p className="text-xs text-destructive">{t("person.reg.acceptRequired")}</p>}
              </div>

              <details className="rounded-xl border border-border p-3 text-sm">
                <summary className="cursor-pointer select-none font-medium">{t("person.reg.previewTitle")}</summary>
                <p className="mt-2 text-xs text-muted-foreground">{t("person.reg.previewLead")}</p>
                <pre lang="en" className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                  {preview}
                </pre>
              </details>
            </>
          )}

          {interestOpen === false && (
            <Alert>
              <AlertDescription>{t("person.reg.interestClosed")}</AlertDescription>
            </Alert>
          )}

          {problem && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <p>
                  <BefText text={t(problem.text, problem.vars)} />
                </p>
                {problem.code === "registration_outcome_unknown" && (
                  <Button type="button" size="sm" variant="outline" className="mt-3" onClick={retry}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    {t("door.tryAgain")}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {busy && (
            <div role="status" className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              <span>{t(submitting)}</span>
            </div>
          )}

          <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={busy}>
            {t(submitLabel)}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
