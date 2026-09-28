export default function AdminLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-[#009345] rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">جاري التحميل...</p>
      </div>
    </div>
  );
}
