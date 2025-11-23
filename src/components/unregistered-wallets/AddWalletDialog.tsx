import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Loader2, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { SimplePool, EventTemplate, finalizeEvent, Filter } from 'nostr-tools';
import { QRScanner } from '@/components/QRScanner';
import { z } from 'zod';

const walletSchema = z.object({
  address: z.string()
    .trim()
    .min(1, { message: "Wallet address is required" })
    .refine((val) => val.startsWith('L'), { message: "Wallet address must start with 'L'" })
    .refine((val) => val.length >= 26 && val.length <= 35, { message: "Invalid wallet address length" }),
  note: z.string()
    .trim()
    .max(200, { message: "Note must be less than 200 characters" })
    .default('')
});

interface ExistingWallet {
  address: string;
  note: string;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return bytes;
}

export default function AddWalletDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const scanProcessedRef = useRef(false);

  const handleScan = (result: string) => {
    // Prevent multiple scans
    if (scanProcessedRef.current) return;
    
    scanProcessedRef.current = true;
    setAddress(result);
    setShowScanner(false);
    toast.success('Wallet address scanned');
    
    // Reset flag after a delay
    setTimeout(() => {
      scanProcessedRef.current = false;
    }, 1000);
  };

  const handleOpenScanner = () => {
    scanProcessedRef.current = false;
    setShowScanner(true);
  };

  const fetchExistingWallets = async (): Promise<ExistingWallet[]> => {
    if (!parameters?.relays || !session?.nostrHexId) return [];

    const pool = new SimplePool();
    const relays = parameters.relays;

    try {
      const filter: Filter = {
        kinds: [30289],
        authors: [session.nostrHexId],
        "#d": [session.nostrHexId],
        limit: 1
      };

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), 10000)
      );

      const events = await Promise.race([
        pool.querySync(relays, filter),
        timeout
      ]);

      if (events.length === 0) return [];

      const event = events[0];
      const wallets: ExistingWallet[] = event.tags
        .filter(t => t[0] === 'w' && t.length >= 3)
        .map(t => ({
          address: t[1],
          note: t[2] || ''
        }));

      return wallets;
    } catch (error) {
      console.error('Error fetching existing wallets:', error);
      return [];
    } finally {
      pool.close(relays);
    }
  };

  const handleSubmit = async () => {
    if (!session?.nostrHexId || !session.nostrPrivateKey || !parameters?.relays) {
      toast.error('Missing authentication or configuration');
      return;
    }

    // Validate input
    try {
      walletSchema.parse({ address, note });
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return;
      }
    }

    setIsPublishing(true);

    try {
      // 1. Fetch existing wallets
      console.log('🔄 Fetching existing wallet list...');
      const existingWallets = await fetchExistingWallets();
      console.log(`📊 Found ${existingWallets.length} existing wallets`);

      // 2. Check for duplicate
      if (existingWallets.some(w => w.address === address)) {
        toast.error('This wallet is already in your list');
        setIsPublishing(false);
        return;
      }

      // 3. Create new wallet list with added wallet
      const updatedWallets = [...existingWallets, { address, note }];

      // 4. Create event template
      const eventTemplate: EventTemplate = {
        kind: 30289,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", session.nostrHexId],
          ["p", session.nostrHexId],
          ["status", "active"],
          ...updatedWallets.map(w => ["w", w.address, w.note])
        ],
        content: ''
      };

      // 5. Sign event
      const privateKeyBytes = hexToBytes(session.nostrPrivateKey);
      const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);

      console.log('✍️ Event signed:', {
        id: signedEvent.id,
        kind: signedEvent.kind,
        wallets: updatedWallets.length
      });

      // 6. Publish to relays
      const pool = new SimplePool();
      const relays = parameters.relays;
      const results: Array<{ relay: string; success: boolean; error?: string }> = [];

      try {
        const publishPromises = relays.map(async (relay: string) => {
          console.log(`🔄 Publishing to ${relay}...`);

          return new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              results.push({ relay, success: false, error: 'Timeout (10s)' });
              console.error(`❌ ${relay}: Timeout`);
              resolve();
            }, 10000);

            try {
              const pubs = pool.publish([relay], signedEvent);

              Promise.race([
                Promise.all(pubs),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Publish timeout')), 8000)
                )
              ]).then(() => {
                clearTimeout(timeout);
                results.push({ relay, success: true });
                console.log(`✅ ${relay}: Published successfully`);
                resolve();
              }).catch((error) => {
                clearTimeout(timeout);
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                results.push({ relay, success: false, error: errorMsg });
                console.error(`❌ ${relay}: ${errorMsg}`);
                resolve();
              });
            } catch (error) {
              clearTimeout(timeout);
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              results.push({ relay, success: false, error: errorMsg });
              console.error(`❌ ${relay}: ${errorMsg}`);
              resolve();
            }
          });
        });

        await Promise.all(publishPromises);

        const successCount = results.filter(r => r.success).length;
        console.log(`📊 Published to ${successCount}/${relays.length} relays`);

        if (successCount === 0) {
          throw new Error('Failed to publish to any relay');
        }

        toast.success(`Wallet added successfully! Published to ${successCount}/${relays.length} relays`);
        setOpen(false);
        setAddress('');
        setNote('');
        onSuccess();

      } finally {
        pool.close(relays);
      }

    } catch (error) {
      console.error('❌ Error publishing wallet:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to add wallet');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Wallet
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Unregistered Wallet</DialogTitle>
          <DialogDescription>
            Add a LanaCoin wallet to your unregistered wallet list. This wallet should be inactive, lost, or archived.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {showScanner ? (
            <div className="space-y-4">
              <QRScanner
                isOpen={showScanner}
                onClose={() => setShowScanner(false)}
                onScan={handleScan}
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="address">Wallet Address *</Label>
                <div className="flex gap-2">
                  <Input
                    id="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Lcp9wA4U2MyV3bE4f92Q1XJ5tPP3ZC2jmd"
                    disabled={isPublishing}
                    maxLength={35}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleOpenScanner}
                    disabled={isPublishing}
                  >
                    <QrCode className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Must start with 'L'
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="note">Note (Optional)</Label>
                <Textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g., lost keys, archived, old wallet"
                  disabled={isPublishing}
                  maxLength={200}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  {note.length}/200 characters
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isPublishing}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={isPublishing || !address}
                >
                  {isPublishing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    'Add Wallet'
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
