export const metadata = {
  title: 'G-CART',
  description: 'Gonzaga Crew Athlete Routing & Transit',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '2rem' }}>
        {children}
      </body>
    </html>
  );
}
