import { useParams, useNavigate } from 'react-router-dom';
import { useNostrTranscript } from '@/hooks/useNostrTranscript';
import { useNostrProfilesCacheBulk } from '@/hooks/useNostrProfilesCacheBulk';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Calendar, Clock, User, Image as ImageIcon, Mic, File } from 'lucide-react';
import { getProxiedImageUrl } from '@/lib/imageProxy';
import { format } from 'date-fns';
import { useMemo } from 'react';

export default function Transcript() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const { transcript, isLoading, error } = useNostrTranscript(caseId || null);

  // Get all unique pubkeys for profile fetching
  const allPubkeys = useMemo(() => {
    if (!transcript) return [];
    const pubkeys = new Set<string>();
    pubkeys.add(transcript.facilitatorPubkey);
    transcript.data.messages.forEach(msg => pubkeys.add(msg.sender_pubkey));
    return Array.from(pubkeys);
  }, [transcript]);

  const { profiles } = useNostrProfilesCacheBulk(allPubkeys);

  const getRoleBadgeColor = (role: string) => {
    switch (role.toLowerCase()) {
      case 'facilitator':
        return 'bg-purple-500/10 text-purple-700 hover:bg-purple-500/20';
      case 'initiator':
        return 'bg-blue-500/10 text-blue-700 hover:bg-blue-500/20';
      case 'participant':
        return 'bg-green-500/10 text-green-700 hover:bg-green-500/20';
      case 'guest':
        return 'bg-gray-500/10 text-gray-700 hover:bg-gray-500/20';
      default:
        return 'bg-secondary';
    }
  };

  const getMessageTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'audio':
        return <Mic className="h-4 w-4" />;
      case 'image':
        return <ImageIcon className="h-4 w-4" />;
      case 'file':
        return <File className="h-4 w-4" />;
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate('/own/search')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Search
        </Button>
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !transcript) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate('/own/search')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Search
        </Button>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">{error || 'Transcript not found'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const facilitator = profiles.get(transcript.facilitatorPubkey);

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={() => navigate('/own/search')}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Search
      </Button>

      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <CardTitle className="text-2xl">{transcript.title}</CardTitle>
                <Badge variant="secondary">{transcript.status}</Badge>
                {transcript.lang && (
                  <Badge variant="outline" className="text-xs uppercase">
                    {transcript.lang}
                  </Badge>
                )}
              </div>
              {transcript.data.summary && (
                <CardDescription className="text-base">
                  {transcript.data.summary}
                </CardDescription>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 text-sm flex-wrap">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>Opened: {format(new Date(transcript.data.opened_at * 1000), 'dd/MM/yyyy HH:mm')}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>Closed: {format(new Date(transcript.data.closed_at * 1000), 'dd/MM/yyyy HH:mm')}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>{transcript.data.messages.length} messages</span>
            </div>
          </div>

          {facilitator && (
            <div className="pt-4 border-t">
              <span className="text-sm text-muted-foreground">Facilitator</span>
              <div className="flex items-center gap-2 mt-1">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={getProxiedImageUrl(facilitator.picture)} />
                  <AvatarFallback>
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium">
                  {facilitator.display_name || facilitator.full_name || `${transcript.facilitatorPubkey.slice(0, 8)}...`}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Messages */}
      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
          <CardDescription>Verbatim message log</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {transcript.data.messages.map((message) => {
              const profile = profiles.get(message.sender_pubkey);
              const icon = getMessageTypeIcon(message.type);

              return (
                <div
                  key={`${message.source_event_id}-${message.seq}`}
                  className="flex gap-3 p-4 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
                >
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarImage src={getProxiedImageUrl(profile?.picture)} />
                    <AvatarFallback>
                      <User className="h-5 w-5" />
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-medium">
                        {profile?.display_name || profile?.full_name || `${message.sender_pubkey.slice(0, 8)}...`}
                      </span>
                      <Badge className={getRoleBadgeColor(message.role)} variant="secondary">
                        {message.role}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(message.timestamp * 1000), 'dd/MM/yyyy HH:mm:ss')}
                      </span>
                      {icon && (
                        <span className="text-muted-foreground">
                          {icon}
                        </span>
                      )}
                    </div>
                    
                    <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>
                    
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {message.attachments.map((attachment, idx) => (
                          <div key={idx} className="text-xs text-muted-foreground">
                            {attachment.kind === 'image' && (
                              <img
                                src={attachment.url}
                                alt="Attachment"
                                className="max-w-xs rounded border"
                              />
                            )}
                            {attachment.kind === 'audio' && (
                              <audio controls className="max-w-xs">
                                <source src={attachment.url} />
                              </audio>
                            )}
                            {attachment.kind === 'file' && (
                              <a
                                href={attachment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:underline"
                              >
                                📎 Download file
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
