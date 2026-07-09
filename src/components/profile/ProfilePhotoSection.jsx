import React, { useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Camera, ImagePlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function ProfilePhotoSection({ member, onSave }) {
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      await onSave({ profilePhoto: file_url });
      toast.success('Photo updated');
    } catch (e) {
      toast.error('Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const initials = `${member.firstName?.[0] || ''}${member.lastName?.[0] || ''}`.toUpperCase();

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      {/* Avatar */}
      <div className="relative">
        <div className={cn(
          "w-24 h-24 rounded-full overflow-hidden bg-primary/10 border-2 border-border flex items-center justify-center",
          uploading && "opacity-60"
        )}>
          {member.profilePhoto ? (
            <img src={member.profilePhoto} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl font-bold text-primary">{initials}</span>
          )}
        </div>
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}
      </div>

      {/* Upload buttons */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className="w-4 h-4" /> Gallery
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={uploading}
          onClick={() => cameraInputRef.current?.click()}
        >
          <Camera className="w-4 h-4" /> Camera
        </Button>
      </div>

      {/* Hidden inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}