-- Align message RLS with app access checks:
-- org admins can view/send without explicit group membership.
DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT USING (
    deleted_at IS NULL
    AND has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND (
      has_active_role(organization_id, array['admin'])
      OR (
        is_chat_group_member(chat_group_id)
        AND (
          status = 'approved'
          OR author_id = auth.uid()
          OR is_chat_group_moderator(chat_group_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS chat_messages_insert ON public.chat_messages;
CREATE POLICY chat_messages_insert ON public.chat_messages
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND author_id = auth.uid()
    AND (
      has_active_role(organization_id, array['admin'])
      OR is_chat_group_member(chat_group_id)
    )
  );
