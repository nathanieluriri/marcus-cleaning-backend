import { Html, Head, Body, Container, Heading, Text, Button, Section } from '@react-email/components'

/**
 * Admin invitation email. Ported from `email_templates/invitation_template.py`.
 * Marcus Cleaning branding; sender display name comes from EMAIL_FROM.
 * See: docs/migration/08-email-resend.md
 */

export interface InvitationEmailProps {
  inviteeEmail: string
  inviteUrl: string
  invitedByName?: string | null
}

export function InvitationEmail({ inviteeEmail, inviteUrl, invitedByName }: InvitationEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>You&apos;ve been invited to Marcus Cleaning</Heading>
          <Text style={text}>
            {invitedByName ? `${invitedByName} has invited` : 'You have been invited'} {inviteeEmail} to join the
            Marcus Cleaning admin portal.
          </Text>
          <Section style={btnWrap}>
            <Button href={inviteUrl} style={button}>
              Accept invitation
            </Button>
          </Section>
          <Text style={muted}>
            If the button doesn&apos;t work, copy and paste this link into your browser: {inviteUrl}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const body = { backgroundColor: '#f4f6f8', fontFamily: 'Arial, sans-serif' }
const container = { backgroundColor: '#ffffff', padding: '32px', borderRadius: '8px', maxWidth: '480px' }
const heading = { fontSize: '20px', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '22px' }
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

export default InvitationEmail
