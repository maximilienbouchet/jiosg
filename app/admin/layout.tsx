export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-screen bg-white text-gray-900"
      style={{ position: "relative", zIndex: 10000 }}
    >
      {children}
    </div>
  );
}
