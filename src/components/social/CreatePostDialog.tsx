import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CreatePost } from "./CreatePost";

interface CreatePostDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerButton?: boolean;
}

export function CreatePostDialog({ 
  open: controlledOpen, 
  onOpenChange: controlledOnOpenChange,
  triggerButton = true 
}: CreatePostDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerButton && (
        <DialogTrigger asChild>
          <Button className="w-full gap-2">
            <Plus className="h-4 w-4" />
            Create Post
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a new post</DialogTitle>
        </DialogHeader>
        <CreatePost onPostCreated={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
