import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '创新实践及科研训练·企业运营模拟（企业1专属版）',
  description: '《创新实践及科研训练》课程配套的企业运营仿真环境，模拟企业1连续四年运营决策',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}