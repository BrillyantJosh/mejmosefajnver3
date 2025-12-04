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

export function CreatePostDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full gap-2">
          <Plus className="h-4 w-4" />
          Create Post
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a new post</DialogTitle>
        </DialogHeader>
        <CreatePost onPostCreated={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
