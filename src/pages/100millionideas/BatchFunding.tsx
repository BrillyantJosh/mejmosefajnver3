import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useLanacrowdProjects, LanacrowdProject } from "@/hooks/useLanacrowdProjects";
import { useNostrUserWallets } from "@/hooks/useNostrUserWallets";
import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Wallet, Loader2, ScanLine, AlertCircle, CheckCircle, Layers, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { convertWifToIds } from "@/lib/crypto";
import { QRScanner } from "@/components/QRScanner";
import { finalizeEvent } from "nostr-tools";
import millionideasTranslations from "@/i18n/modules/millionideas";
import { useTranslation } from "@/i18n/I18nContext";

type BatchStep = 'select' | 'confirm' | 'processing' | 'result';

// Mentor provizija rate: 10% of the gross donation goes to the mentor wallet,
// 90% reaches the project. Kept as a single constant so the MAX gross-up and the
// fee summary stay in sync with the split applied in handleSubmit.
const MENTOR_FEE_RATE = 0.10;

interface BatchEntry {
  project: LanacrowdProject;
  lanaAmount: string;
}

interface BatchResult {
  success: boolean;
  txHash?: string;
  totalLana?: number;
  totalFiat?: number;
  fee?: number;
  entries: { projectTitle: string; lanaAmount: number; fiatAmount: number }[];
  mentorTotal?: number;
  eventsPublished?: number;
  error?: string;
}

// Per-project row component — calls useNostrProjectDonations at top level (React hook rules)
interface ProjectRowProps {
  entry: BatchEntry;
  index: number;
  exchangeRate: number;
  onAmountChange: (index: number, value: string) => void;
}

const ProjectRow = ({ entry, index, exchangeRate, onAmountChange }: ProjectRowProps) => {
  const { t } = useTranslation(millionideasTranslations);
  // Donation stats come from SQLite-backed project (precomputed JOIN)
  const totalRaised = entry.project.totalRaised ?? 0;
  const donationCount = entry.project.donationCount ?? 0;

  const goalFiat = entry.project.fiatGoal || 0;
  const remainingFiat = Math.max(goalFiat - totalRaised, 0);
  const currency = entry.project.currency || 'EUR';
  const maxLana = exchangeRate > 0 ? remainingFiat / exchangeRate : 0;
  // The entered amount is the GROSS donation: 10% goes to the mentor provizija and
  // only 90% reaches the project. So to fully fund the project (deliver `maxLana` net)
  // the gross must be grossed up by the fee — the provizija is added ON TOP, not taken
  // out of the project's funding. This is the value MAX fills and the cap we clamp to.
  const grossMax = maxLana > 0 ? maxLana / (1 - MENTOR_FEE_RATE) : 0;
  const isFullyFunded = remainingFiat <= 0 && goalFiat > 0;

  const lana = parseFloat(entry.lanaAmount) || 0;
  const fiat = lana * exchangeRate;

  const handleChange = (value: string) => {
    const num = parseFloat(value) || 0;
    // Auto-clamp to the grossed-up max (project goal + provizija on top)
    if (num > grossMax && grossMax > 0) {
      onAmountChange(index, grossMax.toFixed(2));
    } else {
      onAmountChange(index, value);
    }
  };

  return (
    <div className={`flex items-center gap-3 p-3 border rounded-lg ${isFullyFunded ? 'opacity-60 bg-green-500/5' : ''}`}>
      {/* Project thumbnail */}
      <div className="w-12 h-12 rounded overflow-hidden flex-shrink-0 bg-muted">
        {entry.project.coverImage ? (
          <img
            src={entry.project.coverImage}
            alt={entry.project.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            {entry.project.title.charAt(0)}
          </div>
        )}
      </div>

      {/* Project info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">{entry.project.title}</p>
        <span className="text-xs text-muted-foreground">
          {t('batch.raisedBackers', { amount: totalRaised.toFixed(2), currency, count: donationCount })}
        </span>
        {isFullyFunded ? (
          <p className="text-xs font-semibold text-green-600">{t('batch.fullyFundedCheck')}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('batch.remaining', { amount: remainingFiat.toFixed(2), currency, max: grossMax.toFixed(2) })}
          </p>
        )}
      </div>

      {/* Amount input */}
      <div className="w-40 flex-shrink-0">
        {isFullyFunded ? (
          <div className="text-center">
            <span className="text-xs font-semibold text-green-600 bg-green-500/10 px-2 py-1 rounded">{t('batch.fullyFunded')}</span>
          </div>
        ) : (
          <>
            <div className="flex gap-1">
              <Input
                type="number"
                value={entry.lanaAmount}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                max={grossMax > 0 ? grossMax.toFixed(2) : undefined}
                className="text-right flex-1"
              />
              {grossMax > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="px-2 h-9 text-xs font-bold shrink-0"
                  onClick={() => onAmountChange(index, grossMax.toFixed(2))}
                >
                  MAX
                </Button>
              )}
            </div>
            {lana > 0 && (
              <p className="text-xs text-muted-foreground text-right mt-1">
                {fiat.toFixed(2)} {currency}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const BatchFunding = () => {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { toast } = useToast();
  const { parameters } = useSystemParameters();
  const { t } = useTranslation(millionideasTranslations);
  // Open filter already excludes hidden/completed/funded/draft at the server.
  // Batch funding only shows approved projects to non-admins — but include the
  // viewer's pubkey so creators always see their own (otherwise consistent with /projects).
  const { projects, isLoading: projectsLoading } = useLanacrowdProjects(
    'open', 1, '', undefined, session?.nostrHexId,
  );
  const { wallets, isLoading: walletsLoading } = useNostrUserWallets(session?.nostrHexId || null);

  const [step, setStep] = useState<BatchStep>('select');
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [entries, setEntries] = useState<BatchEntry[]>([]);

  // Confirm step state
  const [privateKey, setPrivateKey] = useState<string>("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string>("");
  const [isValid, setIsValid] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Processing / result state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [result, setResult] = useState<BatchResult | null>(null);

  // Filter: needs a wallet (server 'open' filter already removes hidden/completed/funded/draft)
  const activeProjects = projects.filter(p => p.status === 'active' && !!p.wallet);

  // Sync entries with activeProjects
  const activeProjectIds = useMemo(() => activeProjects.map(p => p.id).join(','), [activeProjects]);
  useEffect(() => {
    if (activeProjects.length > 0) {
      setEntries(prev => {
        // Preserve any amounts already entered
        const prevMap = new Map(prev.map(e => [e.project.id, e.lanaAmount]));
        return activeProjects.map(p => ({
          project: p,
          lanaAmount: prevMap.get(p.id) || "",
        }));
      });
    }
  }, [activeProjectIds]);

  // Fetch wallet balances
  useEffect(() => {
    if (wallets && wallets.length > 0) {
      const walletIds = wallets.map(w => w.walletId);
      fetchWalletBalances(walletIds);
    }
  }, [wallets]);

  const fetchWalletBalances = async (walletIds: string[]) => {
    setLoadingBalances(true);
    try {
      const electrumServers = parameters?.electrumServers || [];
      if (electrumServers.length === 0) return;

      const { data, error } = await supabase.functions.invoke('get-wallet-balances', {
        body: { wallet_addresses: walletIds, electrum_servers: electrumServers }
      });

      if (error) throw error;
      if (data?.wallets) {
        const balancesMap: Record<string, number> = {};
        data.wallets.forEach((w: { wallet_id: string; balance: number }) => {
          balancesMap[w.wallet_id] = w.balance;
        });
        setWalletBalances(balancesMap);
      }
    } catch (error) {
      console.error('Error fetching wallet balances:', error);
    } finally {
      setLoadingBalances(false);
    }
  };

  // Calculate totals
  const fundedEntries = entries.filter(e => parseFloat(e.lanaAmount) > 0);
  const totalLana = fundedEntries.reduce((sum, e) => sum + (parseFloat(e.lanaAmount) || 0), 0);
  const exchangeRate = parameters?.exchangeRates?.EUR || 0;
  const totalFiat = totalLana * exchangeRate;
  const mentorFee = totalLana * 0.10;
  const selectedWalletBalance = selectedWalletId ? (walletBalances[selectedWalletId] || 0) : 0;
  const hasSufficientBalance = totalLana > 0 && selectedWalletBalance >= totalLana;

  const updateEntryAmount = (index: number, value: string) => {
    setEntries(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], lanaAmount: value };
      return updated;
    });
  };

  // WIF validation (same pattern as DonatePrivateKey)
  useEffect(() => {
    const validateKey = async () => {
      if (!privateKey.trim()) {
        setValidationError("");
        setIsValid(false);
        setIsValidating(false);
        return;
      }
      setIsValidating(true);
      setValidationError("");
      try {
        const result = await convertWifToIds(privateKey.trim());
        const matchesCompressed = result.walletIdCompressed === selectedWalletId;
        const matchesUncompressed = result.walletIdUncompressed === selectedWalletId;
        if (!matchesCompressed && !matchesUncompressed) {
          setValidationError(t('batch.keyMismatch'));
          setIsValid(false);
        } else {
          setValidationError("");
          setIsValid(true);
        }
      } catch (error) {
        setValidationError(t('batch.invalidKeyFormat'));
        setIsValid(false);
      } finally {
        setIsValidating(false);
      }
    };
    const timeoutId = setTimeout(validateKey, 500);
    return () => clearTimeout(timeoutId);
  }, [privateKey, selectedWalletId]);

  const handleQRScan = (data: string) => {
    setPrivateKey(data);
    setShowScanner(false);
  };

  const hexToBytes = (hex: string): Uint8Array => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  };

  // Execute batch transaction
  const handleExecuteBatch = async () => {
    if (!isValid || !parameters || !session?.nostrHexId || !session?.nostrPrivateKey) return;

    setIsProcessing(true);
    setStep('processing');
    setProcessingStatus(t('batch.statusPreparing'));

    try {
      // Step 1: Get service name and mentor settings
      setProcessingStatus(t('batch.statusFetchingMentor'));
      const [{ data: appNameData }, { data: mentorSettingData }] = await Promise.all([
        supabase.from('app_settings').select('value').eq('key', 'app_name').single(),
        supabase.from('app_settings').select('value').eq('key', 'mentor_100million_ideas').maybeSingle()
      ]);

      const serviceName = appNameData?.value || 'LanaCrowd';
      // mentor_100million_ideas stores the wallet address directly (same as single-donation flow)
      const mentorWallet = (mentorSettingData?.value as string) || '';
      // Mentor's Nostr hex id — used only for the ["p", ..., "mentor"] tag on the mentor-fee event
      const mentorHexId = "16a970069d63ca1f739c4e3b9a5f34bca6a93ead182dbf1e438a801aa03f4ef3";

      const hasMentorSplit = !!mentorWallet;

      // Step 2: Build recipients array
      setProcessingStatus(t('batch.statusBuildingOutputs'));
      const recipients: { address: string; amount: number }[] = [];
      let totalMentorLanoshis = 0;

      for (const entry of fundedEntries) {
        const totalLanoshis = Math.floor(parseFloat(entry.lanaAmount) * 100000000);
        const mentorLanoshis = hasMentorSplit ? Math.floor(totalLanoshis * 0.10) : 0;
        const projectLanoshis = totalLanoshis - mentorLanoshis;

        recipients.push({ address: entry.project.wallet, amount: projectLanoshis });
        totalMentorLanoshis += mentorLanoshis;
      }

      // Single aggregated mentor output
      if (hasMentorSplit && totalMentorLanoshis > 546) {
        recipients.push({ address: mentorWallet, amount: totalMentorLanoshis });
      }

      // Step 3: Call send-batch-lana-transaction
      setProcessingStatus(t('batch.statusSending', { count: recipients.length }));
      const { data: txData, error: txError } = await supabase.functions.invoke('send-batch-lana-transaction', {
        body: {
          senderAddress: selectedWalletId,
          recipients,
          privateKey: privateKey.trim(),
          electrumServers: parameters.electrumServers || []
        }
      });

      if (txError || !txData?.success) {
        throw new Error(txData?.error || t('batch.errorBatchFailed'));
      }

      const txHash = txData.txHash;
      const txFee = txData.fee;

      toast({
        title: t('batch.toastTxSuccessTitle'),
        description: t('batch.toastTxSuccessDesc'),
      });

      // Step 4: Create KIND 60200 events per project
      const nowTs = Math.floor(Date.now() / 1000);
      let eventsPublished = 0;

      for (let i = 0; i < fundedEntries.length; i++) {
        const entry = fundedEntries[i];
        const totalLanoshis = Math.floor(parseFloat(entry.lanaAmount) * 100000000);
        const mentorLanoshis = hasMentorSplit ? Math.floor(totalLanoshis * 0.10) : 0;
        const projectLanoshis = totalLanoshis - mentorLanoshis;
        const projectFiat = parseFloat(entry.lanaAmount) * exchangeRate;

        setProcessingStatus(t('batch.statusPublishingEvents', { current: i * 2 + 1, total: fundedEntries.length * 2 }));

        // Event 1: Project donation (90% or 100%)
        const projectEventTemplate = {
          kind: 60200,
          created_at: nowTs,
          tags: [
            ["service", "lanacrowd"],
            ["project", entry.project.id],
            ["p", session.nostrHexId, "supporter"],
            ["p", entry.project.ownerPubkey, "project_owner"],
            ["amount_lanoshis", projectLanoshis.toString()],
            ["amount_fiat", hasMentorSplit
              ? (projectFiat * 0.90).toFixed(2)
              : projectFiat.toFixed(2)],
            ["currency", entry.project.currency],
            ["from_wallet", selectedWalletId],
            ["to_wallet", entry.project.wallet],
            ["tx", txHash],
            ["type", "donation"],
            ["batch", "true"],
            ["timestamp_paid", nowTs.toString()]
          ],
          content: `Batch funding: Supporting ${entry.project.title}`
        };

        const signedProjectEvent = finalizeEvent(projectEventTemplate, hexToBytes(session.nostrPrivateKey));
        const { error: pubErr1 } = await supabase.functions.invoke('publish-dm-event', {
          body: { event: signedProjectEvent }
        });
        if (!pubErr1) eventsPublished++;

        console.log(`📊 Batch donation event [${i + 1}/${fundedEntries.length}]:`, {
          project: entry.project.title,
          projectLanoshis,
          eventId: signedProjectEvent.id
        });

        // Event 2: Mentor fee — only if mentor split is active
        if (hasMentorSplit && mentorLanoshis > 0 && mentorHexId) {
          setProcessingStatus(t('batch.statusPublishingEvents', { current: i * 2 + 2, total: fundedEntries.length * 2 }));

          const mentorEventTemplate = {
            kind: 60200,
            created_at: nowTs,
            tags: [
              ["service", "lanacrowd"],
              ["project", entry.project.id],
              ["p", session.nostrHexId, "supporter"],
              ["p", mentorHexId, "mentor"],
              ["amount_lanoshis", mentorLanoshis.toString()],
              ["amount_fiat", (projectFiat * 0.10).toFixed(2)],
              ["currency", entry.project.currency],
              ["from_wallet", selectedWalletId],
              ["to_wallet", mentorWallet],
              ["tx", txHash],
              ["type", "mentor_fee"],
              ["batch", "true"],
              ["timestamp_paid", nowTs.toString()]
            ],
            content: `Mentor fee for ${entry.project.title} (batch funding)`
          };

          const signedMentorEvent = finalizeEvent(mentorEventTemplate, hexToBytes(session.nostrPrivateKey));
          const { error: pubErr2 } = await supabase.functions.invoke('publish-dm-event', {
            body: { event: signedMentorEvent }
          });
          if (!pubErr2) eventsPublished++;

          console.log(`📊 Mentor fee event [${i + 1}/${fundedEntries.length}]:`, {
            project: entry.project.title,
            mentorLanoshis,
            eventId: signedMentorEvent.id
          });
        }
      }

      // Set result
      setResult({
        success: true,
        txHash,
        totalLana,
        totalFiat,
        fee: txFee / 100000000,
        entries: fundedEntries.map(e => ({
          projectTitle: e.project.title,
          lanaAmount: parseFloat(e.lanaAmount),
          fiatAmount: parseFloat(e.lanaAmount) * exchangeRate
        })),
        mentorTotal: hasMentorSplit ? totalMentorLanoshis / 100000000 : 0,
        eventsPublished
      });
      setStep('result');

    } catch (error) {
      console.error("Batch funding error:", error);
      setResult({
        success: false,
        entries: [],
        error: error instanceof Error ? error.message : t('batch.errorBatchFundingFailed')
      });
      setStep('result');
    } finally {
      setIsProcessing(false);
    }
  };

  // Loading state
  if (projectsLoading || walletsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-background sticky top-0 z-10">
        <div className="container mx-auto p-4 flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => navigate('/100millionideas/projects')}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('batch.backToProjects')}
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Layers className="h-4 w-4" />
            {t('batch.batchFunding')}
          </div>
        </div>
      </div>

      <div className="container mx-auto p-6 max-w-3xl">
        {/* ==================== STEP: SELECT ==================== */}
        {step === 'select' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold">{t('batch.batchFunding')}</h1>
              <p className="text-muted-foreground mt-2">
                {t('batch.selectSubtitle')}
              </p>
            </div>

            {/* Wallet Selector */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('batch.walletFromTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!wallets || wallets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('batch.noWallets')}
                  </p>
                ) : (
                  <>
                    <div>
                      <Label htmlFor="wallet-select">{t('batch.selectWallet')}</Label>
                      <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                        <SelectTrigger id="wallet-select">
                          <SelectValue placeholder={t('batch.selectWallet')} />
                        </SelectTrigger>
                        <SelectContent>
                          {wallets
                            .filter(wallet => wallet.walletType !== 'Lana8Wonder')
                            .map((wallet) => (
                              <SelectItem key={wallet.walletId} value={wallet.walletId}>
                                <div className="flex flex-col items-start">
                                  <div className="font-mono text-xs">
                                    {wallet.walletId.substring(0, 10)}...{wallet.walletId.substring(wallet.walletId.length - 8)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {wallet.walletType} {wallet.note && `- ${wallet.note.substring(0, 20)}`}
                                  </div>
                                </div>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedWalletId && (
                      <div className="bg-muted p-4 rounded-md space-y-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">{t('batch.walletBalance')}</span>
                        </div>
                        <p className="text-sm">
                          <span className="text-muted-foreground">{t('batch.addressLabel')}</span>{' '}
                          <span className="font-mono text-xs">
                            {selectedWalletId.substring(0, 10)}...{selectedWalletId.substring(selectedWalletId.length - 8)}
                          </span>
                        </p>
                        <p className="text-sm">
                          <span className="text-muted-foreground">{t('batch.balanceLabel')}</span>{' '}
                          {loadingBalances ? (
                            <Loader2 className="h-3 w-3 animate-spin inline" />
                          ) : (
                            <span className="font-semibold">
                              {walletBalances[selectedWalletId] !== undefined
                                ? `${walletBalances[selectedWalletId].toFixed(2)} LANA`
                                : t('batch.loading')}
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Project List with Amount Inputs */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('batch.enterAmounts')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {entries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('batch.noActiveProjects')}</p>
                ) : (
                  entries.map((entry, index) => (
                    <ProjectRow
                      key={entry.project.id}
                      entry={entry}
                      index={index}
                      exchangeRate={exchangeRate}
                      onAmountChange={updateEntryAmount}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            {/* Summary */}
            {totalLana > 0 && (
              <Card className="border-green-500/20 bg-green-500/5">
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('batch.projectsToFund')}</span>
                    <span className="font-semibold">{fundedEntries.length}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('batch.totalLana')}</span>
                    <span className="font-semibold">{totalLana.toFixed(2)} LANA</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('batch.totalFiat')}</span>
                    <span className="font-semibold">{totalFiat.toFixed(2)} EUR</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('batch.mentorFeeLabel')}</span>
                    <span className="font-semibold">{mentorFee.toFixed(2)} LANA</span>
                  </div>
                  <div className="border-t pt-2 mt-2">
                    {selectedWalletId ? (
                      hasSufficientBalance ? (
                        <p className="text-sm text-green-500 flex items-center gap-2">
                          <CheckCircle className="h-4 w-4" /> {t('batch.sufficientBalance')}
                        </p>
                      ) : (
                        <p className="text-sm text-destructive flex items-center gap-2">
                          <AlertCircle className="h-4 w-4" /> {t('batch.insufficientBalance', { amount: selectedWalletBalance.toFixed(2) })}
                        </p>
                      )
                    ) : (
                      <p className="text-sm text-muted-foreground">{t('batch.selectWalletToContinue')}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Continue Button */}
            <Button
              onClick={() => setStep('confirm')}
              disabled={!selectedWalletId || fundedEntries.length === 0 || !hasSufficientBalance || loadingBalances}
              className="w-full bg-green-500 hover:bg-green-600 text-white h-12 disabled:opacity-50"
            >
              {t('batch.continueBtn', { count: fundedEntries.length, projects: t(fundedEntries.length === 1 ? 'batch.projectOne' : 'batch.projectMany'), lana: totalLana.toFixed(2) })}
            </Button>
          </div>
        )}

        {/* ==================== STEP: CONFIRM ==================== */}
        {step === 'confirm' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold">{t('batch.confirmTitle')}</h1>
              <p className="text-muted-foreground mt-2">
                {t('batch.confirmSubtitle')}
              </p>
            </div>

            {/* Summary Card */}
            <Card className="border-green-500/20 bg-green-500/5">
              <CardHeader>
                <CardTitle className="text-lg">{t('batch.batchSummary')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {fundedEntries.map(entry => {
                  const lana = parseFloat(entry.lanaAmount) || 0;
                  const fiat = lana * exchangeRate;
                  return (
                    <div key={entry.project.id} className="flex justify-between">
                      <span className="text-muted-foreground truncate mr-4">{entry.project.title}</span>
                      <span className="font-semibold whitespace-nowrap">
                        {lana.toFixed(2)} LANA ({fiat.toFixed(2)} EUR)
                      </span>
                    </div>
                  );
                })}
                <div className="border-t pt-2 mt-2 flex justify-between font-bold">
                  <span>{t('batch.total')}</span>
                  <span>{totalLana.toFixed(2)} LANA ({totalFiat.toFixed(2)} EUR)</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t('batch.mentorFeeShort')}</span>
                  <span>{mentorFee.toFixed(2)} LANA</span>
                </div>
              </CardContent>
            </Card>

            {/* Wallet Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('batch.fromWallet')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted p-3 rounded-md">
                  <p className="font-mono text-sm break-all">{selectedWalletId}</p>
                </div>
              </CardContent>
            </Card>

            {/* Private Key Input */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('batch.privateKeyTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="private-key">{t('batch.privateKeyLabel')}</Label>
                  <div className="flex gap-2 mt-2">
                    <div className="relative flex-1">
                      <Input
                        id="private-key"
                        type="password"
                        value={privateKey}
                        onChange={(e) => setPrivateKey(e.target.value)}
                        placeholder="6v7y8KLxbYtvcp1PRQXLQBX..."
                        className="font-mono pr-10"
                      />
                      {isValidating && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {!isValidating && isValid && (
                        <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                      )}
                      {!isValidating && validationError && (
                        <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowScanner(true)}
                      title={t('batch.scanQr')}
                    >
                      <ScanLine className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t('batch.privateKeyHint')}
                  </p>
                </div>

                {validationError && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                    <AlertCircle className="h-4 w-4" />
                    <span>{validationError}</span>
                  </div>
                )}

                {isValid && (
                  <div className="flex items-center gap-2 text-sm text-green-600 bg-green-500/10 p-3 rounded-md">
                    <CheckCircle className="h-4 w-4" />
                    <span>{t('batch.privateKeyVerified')}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex gap-4">
              <Button
                variant="outline"
                onClick={() => { setStep('select'); setPrivateKey(""); setIsValid(false); setValidationError(""); }}
                className="flex-1 h-12"
              >
                {t('batch.back')}
              </Button>
              <Button
                onClick={handleExecuteBatch}
                disabled={!isValid || isValidating}
                className="flex-1 bg-green-500 hover:bg-green-600 text-white h-12 disabled:opacity-50"
              >
                {t('batch.executeBatch')}
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              {t('batch.privateKeySecure')}
            </p>
          </div>
        )}

        {/* ==================== STEP: PROCESSING ==================== */}
        {step === 'processing' && (
          <div className="space-y-6">
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 animate-spin text-green-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold">{t('batch.processingTitle')}</h2>
              <p className="text-muted-foreground mt-2">{processingStatus}</p>
              <p className="text-xs text-muted-foreground mt-4">
                {t('batch.doNotClose')}
              </p>
            </div>
          </div>
        )}

        {/* ==================== STEP: RESULT ==================== */}
        {step === 'result' && result && (
          <div className="space-y-6">
            {result.success ? (
              <>
                <div className="text-center">
                  <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                  <h1 className="text-3xl font-bold text-green-600">{t('batch.successTitle')}</h1>
                  <p className="text-muted-foreground mt-2">
                    {t('batch.resultSubtitle', { count: result.entries.length, projects: t(result.entries.length === 1 ? 'batch.projectOne' : 'batch.projectMany') })}
                  </p>
                </div>

                {/* Transaction Details */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">{t('batch.txDetails')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('batch.txHash')}</span>
                      <a
                        href={`https://chainz.cryptoid.info/lana/tx.dws?${result.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-blue-500 hover:underline flex items-center gap-1"
                      >
                        {result.txHash?.substring(0, 16)}...
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('batch.totalSent')}</span>
                      <span className="font-semibold">{result.totalLana?.toFixed(2)} LANA</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('batch.totalFiat')}</span>
                      <span className="font-semibold">{result.totalFiat?.toFixed(2)} EUR</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('batch.networkFee')}</span>
                      <span>{result.fee?.toFixed(8)} LANA</span>
                    </div>
                    {result.mentorTotal && result.mentorTotal > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('batch.mentorFeeResultLabel')}</span>
                        <span>{result.mentorTotal.toFixed(2)} LANA</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('batch.eventsPublished')}</span>
                      <span>{result.eventsPublished}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Per-Project Breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">{t('batch.fundedProjects')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {result.entries.map((entry, i) => (
                      <div key={i} className="flex justify-between text-sm py-1 border-b last:border-0">
                        <span className="truncate mr-4">{entry.projectTitle}</span>
                        <span className="font-semibold whitespace-nowrap">
                          {entry.lanaAmount.toFixed(2)} LANA ({entry.fiatAmount.toFixed(2)} EUR)
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Button
                  onClick={() => navigate('/100millionideas/projects')}
                  className="w-full bg-green-500 hover:bg-green-600 text-white h-12"
                >
                  {t('batch.backToProjects')}
                </Button>
              </>
            ) : (
              <>
                <div className="text-center">
                  <AlertCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
                  <h1 className="text-3xl font-bold text-destructive">{t('batch.failedTitle')}</h1>
                  <p className="text-muted-foreground mt-2">{result.error}</p>
                </div>

                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    onClick={() => navigate('/100millionideas/projects')}
                    className="flex-1 h-12"
                  >
                    {t('batch.backToProjects')}
                  </Button>
                  <Button
                    onClick={() => {
                      setStep('select');
                      setPrivateKey("");
                      setIsValid(false);
                      setValidationError("");
                      setResult(null);
                    }}
                    className="flex-1 bg-green-500 hover:bg-green-600 text-white h-12"
                  >
                    {t('batch.tryAgain')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* QR Scanner Dialog */}
      <QRScanner
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleQRScan}
      />
    </div>
  );
};

export default BatchFunding;
