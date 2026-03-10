import { Skeleton } from "@/components/ui/skeleton";

const listClassName = "overflow-hidden rounded-lg border bg-card";
const listRowClassName = "border-b border-border px-4 py-3 last:border-b-0";
const detailCardClassName = "rounded-lg border bg-card px-5 py-4";

function ListRowCheckboxSkeleton() {
  return <Skeleton className="mt-0.5 size-4 rounded-sm" />;
}

function RowMenuSkeleton() {
  return <Skeleton className="h-8 w-8 shrink-0" />;
}

function ListDateSkeleton() {
  return <Skeleton className="h-3 w-28 shrink-0" />;
}

function ProjectListRowSkeleton() {
  return (
    <li className={listRowClassName}>
      <div className="flex items-start gap-3">
        <ListRowCheckboxSkeleton />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-4 w-44 max-w-[65%]" />
            <ListDateSkeleton />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
        <RowMenuSkeleton />
      </div>
    </li>
  );
}

function CustomerListRowSkeleton() {
  return (
    <li className={listRowClassName}>
      <div className="flex items-start gap-3">
        <ListRowCheckboxSkeleton />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2">
              <Skeleton className="size-2 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-40 max-w-[60%]" />
            </div>
            <ListDateSkeleton />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <RowMenuSkeleton />
      </div>
    </li>
  );
}

function DetailProjectRowSkeleton() {
  return (
    <li className={listRowClassName}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-4 w-44 max-w-[65%]" />
            <ListDateSkeleton />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
        <RowMenuSkeleton />
      </div>
    </li>
  );
}

function TimelineSummarySkeleton({ includeExtraLine = false }: { includeExtraLine?: boolean }) {
  return (
    <div className="mt-2 space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      {includeExtraLine ? <Skeleton className="h-4 w-2/3" /> : null}
    </div>
  );
}

function TimelineMessageSkeleton() {
  return (
    <li className={listRowClassName}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-4 w-28" />
        <ListDateSkeleton />
      </div>
      <div className="mt-2 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </li>
  );
}

function TimelineBatchSkeleton({ showMediaRow = false }: { showMediaRow?: boolean }) {
  return (
    <section className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Skeleton className="h-3 w-28" />
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-[72%] max-w-3xl" />
            <Skeleton className="h-3 w-[58%] max-w-xl" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-28" />
          </div>
        </div>
      </div>

      <ul className={listClassName}>
        <li className={listRowClassName}>
          <Skeleton className="h-3 w-24" />
          <TimelineSummarySkeleton includeExtraLine />
        </li>

        {showMediaRow ? (
          <li className={listRowClassName}>
            <div className="space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-40 w-full rounded-md sm:max-w-xs" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </li>
        ) : null}

        <TimelineMessageSkeleton />
        <TimelineMessageSkeleton />
      </ul>
    </section>
  );
}

function DetailCardSkeleton({
  actionWidth,
  content,
}: {
  actionWidth?: string;
  content: React.ReactNode;
}) {
  return (
    <div className={detailCardClassName}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{content}</div>
        {actionWidth ? <Skeleton className={`h-8 ${actionWidth}`} /> : null}
      </div>
    </div>
  );
}

function DetailSectionToggleSkeleton({
  breakpoint,
}: {
  breakpoint: "sm" | "lg";
}) {
  const layoutClassName =
    breakpoint === "lg"
      ? "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
      : "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between";

  return (
    <div className={layoutClassName}>
      <TabsListSkeleton />
      <Skeleton className="h-9 w-28" />
    </div>
  );
}

function ListContainerSkeleton({ children }: { children: React.ReactNode }) {
  return <ul className={listClassName}>{children}</ul>;
}

function TabsListSkeleton() {
  return (
    <div className="inline-flex h-9 items-center gap-1 rounded-lg border bg-muted/40 p-1">
      <Skeleton className="h-7 w-[4.5rem] rounded-md" />
      <Skeleton className="h-7 w-[4.5rem] rounded-md" />
    </div>
  );
}

function ListHeaderActionsSkeleton() {
  return (
    <>
      <div className="relative flex items-center">
        <Skeleton className="h-7 w-40 sm:w-56" />
        <Skeleton className="pointer-events-none absolute left-2.5 size-4 rounded-full" />
      </div>
      <Skeleton className="h-8 w-32" />
    </>
  );
}

function DetailHeaderActionsSkeleton() {
  return (
    <>
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-8 w-24" />
    </>
  );
}

function DetailHeaderTitleSkeleton() {
  return (
    <div className="min-w-0 flex-1">
      <Skeleton className="h-4 w-32 max-w-full sm:w-44" />
    </div>
  );
}

function ProjectsListSkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      <DetailSectionToggleSkeleton breakpoint="lg" />
      <ListContainerSkeleton>
        <ProjectListRowSkeleton />
        <ProjectListRowSkeleton />
        <ProjectListRowSkeleton />
        <ProjectListRowSkeleton />
        <ProjectListRowSkeleton />
      </ListContainerSkeleton>
    </div>
  );
}

function CustomersListSkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      <div className="space-y-3">
        <ListContainerSkeleton>
          <CustomerListRowSkeleton />
          <CustomerListRowSkeleton />
          <CustomerListRowSkeleton />
        </ListContainerSkeleton>

        <section className="space-y-3">
          <Skeleton className="h-3 w-36" />
          <ListContainerSkeleton>
            <CustomerListRowSkeleton />
            <CustomerListRowSkeleton />
          </ListContainerSkeleton>
        </section>
      </div>
    </div>
  );
}

function CustomerDetailSkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      <section className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <DetailCardSkeleton
            content={
              <div className="space-y-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-52" />
                <Skeleton className="h-4 w-36" />
              </div>
            }
          />
          <DetailCardSkeleton
            content={
              <div className="space-y-3">
                <Skeleton className="h-3 w-32" />
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton className="h-6 w-28 rounded-full" />
                  <Skeleton className="h-6 w-24 rounded-full" />
                </div>
              </div>
            }
          />
        </div>

        <DetailSectionToggleSkeleton breakpoint="sm" />
      </section>

      <ListContainerSkeleton>
        <DetailProjectRowSkeleton />
        <DetailProjectRowSkeleton />
        <DetailProjectRowSkeleton />
      </ListContainerSkeleton>
    </div>
  );
}

function ProjectTimelineSkeleton({ sections = 2 }: { sections?: number }) {
  return (
    <div aria-hidden className="space-y-6">
      {Array.from({ length: sections }, (_, index) => (
        <TimelineBatchSkeleton key={index} showMediaRow={index === 0} />
      ))}
    </div>
  );
}

function ProjectTimelineLoadingSkeleton() {
  return (
    <div aria-hidden className="rounded-lg border bg-card px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3 w-[72%] max-w-2xl" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
    </div>
  );
}

function ProjectDetailSkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      <section className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <DetailCardSkeleton
            actionWidth="w-16"
            content={
              <div className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-5 w-40" />
              </div>
            }
          />
          <DetailCardSkeleton
            actionWidth="w-24"
            content={
              <div className="space-y-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-4 w-32" />
              </div>
            }
          />
        </div>

        <DetailSectionToggleSkeleton breakpoint="sm" />
      </section>

      <ProjectTimelineSkeleton />
    </div>
  );
}

export {
  CustomersListSkeleton,
  CustomerDetailSkeleton,
  DetailHeaderActionsSkeleton,
  DetailHeaderTitleSkeleton,
  ListHeaderActionsSkeleton,
  ProjectDetailSkeleton,
  ProjectsListSkeleton,
  ProjectTimelineLoadingSkeleton,
};
