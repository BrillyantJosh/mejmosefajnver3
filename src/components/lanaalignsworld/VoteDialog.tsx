import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AlertTriangle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface VoteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  voteType: 'yes' | 'resistance';
  proposalTitle: string;
  onSubmit: (content: string) => Promise<void>;
  isSubmitting: boolean;
  existingContent?: string;
}

export default function VoteDialog({ 
  isOpen, 
  onClose, 
  voteType, 
  proposalTitle, 
  onSubmit, 
  isSubmitting,
  existingContent = ''
}: VoteDialogProps) {
  const [content, setContent] = useState(existingContent);

  const handleSubmit = async () => {
    await onSubmit(content);
  };

  const isResistance = voteType === 'resistance';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isResistance ? (
              <>
                <XCircle className="h-5 w-5 text-destructive" />
                Resist Proposal
              </>
            ) : (
              <>
                <CheckCircle className="h-5 w-5 text-green-500" />
                Accept Proposal
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {proposalTitle}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isResistance && (
            <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>Important:</strong> The purpose of resistance is to help improve the proposal so it better serves everyone. 
                Be aware that ego-based resistance will automatically trigger a self-responsibility process. 
                Nothing is perfect, so it's crucial to act from genuine feelings. 
                Resistance is an exceptionally responsible function — use it wisely.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="vote-content">
              {isResistance 
                ? 'Your reasoning for resistance (required)' 
                : 'Your comment (optional)'}
            </Label>
            <Textarea
              id="vote-content"
              placeholder={isResistance 
                ? 'Explain why you feel this proposal needs improvement and what aspects should be reconsidered...'
                : 'Share your thoughts on this proposal...'}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={isSubmitting || (isResistance && !content.trim())}
            variant={isResistance ? 'destructive' : 'default'}
            className={!isResistance ? 'bg-green-600 hover:bg-green-700' : ''}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                {isResistance ? 'Submit Resistance' : 'Submit Acceptance'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
