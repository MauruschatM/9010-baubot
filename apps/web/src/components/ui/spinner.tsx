import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n-provider"
import { RiLoaderLine } from "@remixicon/react"

type SpinnerProps = Omit<React.ComponentProps<typeof RiLoaderLine>, "className"> & {
  className?: string
}

function Spinner({ className, ...props }: SpinnerProps) {
  const { t } = useI18n()

  return (
    <RiLoaderLine
      role="status"
      aria-label={t("common.state.loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
