import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, XCircle, ExternalLink, ArrowLeft, Wifi } from "lucide-react";
import millionideasTranslations from "@/i18n/modules/millionideas";
import { useTranslation } from "@/i18n/I18nContext";

export default function DonateResult() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation(millionideasTranslations);

  const success = searchParams.get("success") === "true";
  const txHash = searchParams.get("txHash") || "";
  const error = searchParams.get("error") || "";
  const projectId = searchParams.get("projectId") || "";
  const projectTitle = searchParams.get("projectTitle") || "";
  const amount = searchParams.get("amount") || "";
  const currency = searchParams.get("currency") || "EUR";
  const lanaAmount = searchParams.get("lanaAmount") || "";
  const fee = searchParams.get("fee") || "";
  const senderAddress = searchParams.get("senderAddress") || "";
  const recipientAddress = searchParams.get("recipientAddress") || "";
  const relaysPublished = searchParams.get("relaysPublished") || "0";
  const totalRelays = searchParams.get("totalRelays") || "0";
  const eventId = searchParams.get("eventId") || "";

  const explorerUrl = txHash
    ? `https://chainz.cryptoid.info/lana/tx.dws?${txHash}`
    : null;

  return (
    <div className="max-w-2xl mx-auto">
      <Button
        variant="ghost"
        onClick={() => navigate(`/100millionideas/project/${projectId}`)}
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        {t("donateResult.backToProject")}
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {success ? (
              <>
                <CheckCircle2 className="h-6 w-6 text-green-500" />
                {t("donateResult.donationSuccessful")}
              </>
            ) : (
              <>
                <XCircle className="h-6 w-6 text-destructive" />
                {t("donateResult.donationFailed")}
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {success ? (
            <>
              {/* Success Details */}
              <Alert className="border-green-500/20 bg-green-500/5">
                <AlertDescription>
                  <p className="font-semibold text-green-600">
                    {t("donateResult.thankYou", { projectTitle })}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("donateResult.processedOnChain")}
                  </p>
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                {/* Transaction Details */}
                <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                  <h3 className="font-semibold">{t("donateResult.transactionDetails")}</h3>

                  <div>
                    <p className="text-sm text-muted-foreground">{t("donateResult.transactionId")}</p>
                    <p className="font-mono text-sm break-all">{txHash}</p>
                  </div>

                  {explorerUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => window.open(explorerUrl, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {t("donateResult.viewOnExplorer")}
                    </Button>
                  )}
                </div>

                {/* Donation Summary */}
                <div className="grid gap-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t("donateResult.project")}</span>
                    <span className="font-semibold">{projectTitle}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t("donateResult.donationAmount")}</span>
                    <span className="font-semibold">{amount} {currency}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t("donateResult.lanaAmount")}</span>
                    <span className="font-semibold">{lanaAmount} LANA</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t("donateResult.transactionFee")}</span>
                    <span className="text-sm">{fee} LANA</span>
                  </div>

                  <div className="pt-3 border-t">
                    <div className="flex justify-between items-start">
                      <span className="text-sm text-muted-foreground">{t("donateResult.fromWallet")}</span>
                      <span className="font-mono text-xs text-right break-all max-w-[200px]">
                        {senderAddress}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between items-start">
                    <span className="text-sm text-muted-foreground">{t("donateResult.toProjectWallet")}</span>
                    <span className="font-mono text-xs text-right break-all max-w-[200px]">
                      {recipientAddress}
                    </span>
                  </div>
                </div>

                {/* Nostr Broadcast Info */}
                <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg space-y-2">
                  <div className="flex items-center gap-2">
                    <Wifi className="h-4 w-4 text-blue-500" />
                    <h3 className="font-semibold text-blue-600">{t("donateResult.nostrBroadcast")}</h3>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {t("donateResult.publishedToRelays", { relaysPublished, totalRelays })}
                  </p>

                  {eventId && (
                    <div className="mt-2">
                      <p className="text-xs text-muted-foreground">{t("donateResult.eventId")}</p>
                      <p className="font-mono text-xs break-all">{eventId}</p>
                    </div>
                  )}
                </div>
              </div>

              <Button
                className="w-full"
                onClick={() => navigate(`/100millionideas/project/${projectId}`)}
              >
                {t("donateResult.backToProject")}
              </Button>
            </>
          ) : (
            <>
              {/* Error Details */}
              <Alert variant="destructive">
                <AlertDescription className="space-y-2">
                  <p className="font-semibold">{t("donateResult.donationFailed")}</p>
                  <p className="text-sm">{error}</p>
                </AlertDescription>
              </Alert>

              <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                <p className="text-sm font-medium">{t("donateResult.donationDetails")}</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t("donateResult.projectColon")}</span>
                    <span className="text-sm">{projectTitle}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t("donateResult.amountColon")}</span>
                    <span className="text-sm">{amount} {currency}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Button
                  className="w-full"
                  onClick={() => navigate(`/100millionideas/donate/${projectId}`)}
                >
                  {t("donateResult.tryAgain")}
                </Button>

                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => navigate(`/100millionideas/project/${projectId}`)}
                >
                  {t("donateResult.backToProject")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
