import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '用友ERP沙盘模拟（企业1专属版）',
  description: '基于《创新实践及科研训练》课程用友ERP沙盘体系，构建企业1专属仿真环境',
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