import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, LogOut, Loader2, AlertTriangle, Snowflake } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { useNostrOpenProcesses } from "@/hooks/useNostrOpenProcesses";
import { PROCESS_EXIT_KIND } from "@/hooks/useNostrProcessExitState";
import { finalizeEvent } from 'nostr-tools';
import { supabase } from "@/integrations/supabase/client";
import { toast } from 'sonner';

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

export default function ExitProcess() {
  const { processId } = useParams<{ processId: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters } = useSystemParameters();

  const { processes, isLoading } = useNostrOpenProcesses(session?.nostrHexId || null);
  const process = processes.find((p) => p.id === processId);

  const [step, setStep] = useState<1 | 2>(1);
  const [statement, setStatement] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const goBack = () => navigate('/own');

  const handleConfirmExit = async () => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast.error('You must be logged in');
      return;
    }
    if (!process) return;
    if (!statement.trim()) {
      toast.error('Please write your statement');
      return;
    }

    setIsSubmitting(true);
    try {
      const tags: string[][] = [
        ['e', process.processEventId, '', 'process'],
        ['a', `37044:${process.initiator}:${process.id}`],
        ['action', 'exit'],
        ['client', 'lana-own'],
      ];
      if (process.initiator) tags.push(['p', process.initiator, '', 'initiator']);
      if (process.facilitator) tags.push(['p', process.facilitator, '', 'facilitator']);

      const signedEvent = finalizeEvent(
        {
          kind: PROCESS_EXIT_KIND,
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content: statement.trim(),
        },
        hexToBytes(session.nostrPrivateKey),
      );

      // Publish via the reliable server-side endpoint, with the queue fallback —
      // identical to the OWN message-send path.
      const { data: publishData } = await supabase.functions.invoke('publish-dm-event', {
        body: { event: signedEvent },
      });
      supabase.functions
        .invoke('queue-relay-event', {
          body: { signedEvent, userPubkey: session.nostrHexId },
        })
        .catch(() => {});

      const successCount = publishData?.publishedTo || 0;
      console.log(`✅ Exit event published to ${successCount} relays`);

      toast.success('You have exited the process');
      navigate('/own');
    } catch (error) {
      console.error('Error publishing exit event:', error);
      toast.error('Failed to exit the process');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Guards -------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-4 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const eligibleRole = process?.userRole === 'participant' || process?.userRole === 'initiator';
  const notEligible = !process || !eligibleRole || process.status !== 'open';
  if (notEligible) {
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={goBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Exit the process</h1>
        </div>
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            {!process
              ? 'This process was not found or is no longer open.'
              : process.status !== 'open'
                ? 'This process is no longer open, so it cannot be exited.'
                : 'Only participants or the initiator can exit a process.'}
          </CardContent>
        </Card>
        <Button className="w-full" variant="outline" onClick={goBack}>
          Back to processes
        </Button>
      </div>
    );
  }

  // --- Two-step flow ------------------------------------------------------
  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={step === 2 ? () => setStep(1) : goBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <LogOut className="h-6 w-6 text-destructive" />
          <h1 className="text-2xl font-bold">Exit the process</h1>
        </div>
      </div>

      <p className="text-sm text-muted-foreground -mt-2 truncate">{process.title}</p>

      {step === 1 ? (
        <>
          <Alert variant="destructive" className="border-blue-500/50 bg-blue-500/10">
            <Snowflake className="h-4 w-4 text-blue-500" />
            <AlertTitle className="text-blue-700 dark:text-blue-400">
              This is a conscious, key-signed decision
            </AlertTitle>
            <AlertDescription className="text-blue-700/80 dark:text-blue-300/80 space-y-2">
              <p>
                By confirming, you create a message signed with your own key. The registrar receives it
                and <strong>freezes all of your wallets</strong>.
              </p>
              <p>
                Your wallets stay frozen for <strong>3 more SPLITs</strong>, after which they are
                <strong> automatically deregistered</strong>.
              </p>
              <p>
                You can cancel this at any time while the process is still open by
                <strong> re-entering the process</strong> — your wallets are then unfrozen and the
                deregistration is called off.
              </p>
            </AlertDescription>
          </Alert>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={goBack}>
              Cancel
            </Button>
            <Button variant="destructive" className="flex-1" onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your statement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Please state, in your own words, why you are exiting this process. Your statement is
                stored in the signed event and is visible to the other participants.
              </p>
              <Textarea
                placeholder="Write your statement..."
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                rows={5}
                className="resize-none"
                disabled={isSubmitting}
              />
              <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                Confirming will freeze your wallets via the registrar, as explained on the previous step.
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setStep(1)} disabled={isSubmitting}>
              Back
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleConfirmExit}
              disabled={isSubmitting || !statement.trim()}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Exiting...
                </>
              ) : (
                <>
                  <LogOut className="h-4 w-4 mr-2" />
                  Confirm exit
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
