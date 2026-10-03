'use client';
import { Check, Share } from 'lucide-react';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';
import { useCopyButton } from 'fumadocs-ui/utils/use-copy-button';
import { useT } from '@/lib/i18n';

export function ShareButton({ url }: { url: string }) {
  const t = useT('blog');
  const [isChecked, onCopy] = useCopyButton(() => {
    void navigator.clipboard.writeText(`${window.location.origin}${url}`);
  });

  return (
    <button type="button" className={cn(buttonVariants({ className: 'gap-2' }))} onClick={onCopy}>
      {isChecked ? <Check className="size-4" /> : <Share className="size-4" />}
      {t(isChecked ? 'copied' : 'share')}
    </button>
  );
}
