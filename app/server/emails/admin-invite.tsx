import { Html, Head, Body, Container, Heading, Text, Button, Section } from '@react-email/components'

/**
 * Invite-only admin creation email (Task 5). Carries the one-time temporary
 * password an invited admin uses to log in before being forced through
 * `mustChangePassword`. Styled to match `invitation.tsx`.
 * See: docs/superpowers/plans/2026-07-29-admin-platform-backend.md (Task 5)
 */

export interface AdminInviteEmailProps {
  inviteeEmail: string
  tempPassword: string
  invitedByName?: string | null
  loginUrl: string
}

export function AdminInviteEmail({ inviteeEmail, tempPassword, invitedByName, loginUrl }: AdminInviteEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>You&apos;ve been invited to Marcus Cleaning</Heading>
          <Text style={text}>
            {invitedByName ? `${invitedByName} has invited` : 'You have been invited'} {inviteeEmail}{' '}to join the
            Marcus Cleaning admin portal. Use the temporary password below to sign in — you&apos;ll be asked to set
            a new password immediately.
          </Text>
          <Section style={codeWrap}>
            <Text style={code}>{tempPassword}</Text>
          </Section>
          <Section style={btnWrap}>
            <Button href={loginUrl} style={button}>
              Sign in
            </Button>
          </Section>
          <Text style={muted}>
            If the button doesn&apos;t work, copy and paste this link into your browser: {loginUrl}
          </Text>
          <Text style={muted}>This temporary password expires in 72 hours.</Text>
        </Container>
      </Body>
    </Html>
  )
}

const body = { backgroundColor: '#f4f6f8', fontFamily: 'Arial, sans-serif' }
const container = { backgroundColor: '#ffffff', padding: '32px', borderRadius: '8px', maxWidth: '480px' }
const heading = { fontSize: '20px', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '22px' }
const codeWrap = { textAlign: 'center' as const, margin: '20px 0' }
const code = {
  backgroundColor: '#f1f5f9',
  color: '#0f172a',
  padding: '10px 18px',
  borderRadius: '6px',
  fontSize: '16px',
  fontFamily: 'monospace',
  letterSpacing: '1px',
  display: 'inline-block' as const,
}
const btnWrap = { textAlign: 'center' as const, margin: '24px 0' }
const button = {
  backgroundColor: '#0f172a',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '6px',
  fontSize: '14px',
  textDecoration: 'none',
}
const muted = { fontSize: '12px', color: '#64748b', lineHeight: '18px', wordBreak: 'break-all' as const }

export default AdminInviteEmail
