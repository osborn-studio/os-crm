import { useState, useEffect } from 'react';
import { List, Badge, Button, Space, Tabs, Empty } from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import request from '../../services/request';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const TYPE_ICONS: Record<string, string> = {
  'approval.created': '📋', 'pool.assigned': '👤', 'pool.recycled': '♻️',
  'opportunity.stalled': '⚠️', 'payment_plan.overdue': '💰', 'contract.expiring_soon': '📄',
  'milestone.delayed': '🚨', 'project.completed': '✅',
};

export default function NotificationCenterPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'unread'>('all');

  const loadData = async (showUnreadOnly = false) => {
    setLoading(true);
    try {
      const [list, count]: any[] = await Promise.all([
        request.get('/notifications', { params: { pageSize: 50, is_read: showUnreadOnly ? 'false' : undefined } }),
        request.get('/notifications/unread-count'),
      ]);
      setNotifications(list?.items || []);
      setUnreadCount(count?.count || 0);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(tab === 'unread'); }, [tab]);

  const handleRead = async (id: number) => {
    await request.put(`/notifications/${id}/read`);
    loadData(tab === 'unread');
  };

  const handleReadAll = async () => {
    await request.put('/notifications/read-all');
    loadData(tab === 'unread');
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}><BellOutlined style={{ marginRight: 8 }} />通知中心 {unreadCount > 0 && <Badge count={unreadCount} />}</h2>
        <Button icon={<CheckOutlined />} onClick={handleReadAll} disabled={unreadCount === 0}>全部已读</Button>
      </div>

      <Tabs activeKey={tab} onChange={(k) => setTab(k as any)} items={[
        { key: 'all', label: '全部' },
        { key: 'unread', label: `未读(${unreadCount})` },
      ]} />

      {notifications.length === 0 ? <Empty description="暂无通知" /> : (
        <List
          loading={loading}
          dataSource={notifications}
          renderItem={(item: any) => (
            <List.Item
              style={{ background: item.isRead ? 'transparent' : '#eff6ff', padding: '12px 16px', marginBottom: 4, borderRadius: 4, cursor: 'pointer' }}
              onClick={() => !item.isRead && handleRead(item.id)}
              actions={[
                ...(item.bizType === 'service-ticket' && Number.isSafeInteger(item.bizId) ? [<a key="ticket" href={`/service-tickets?ticketId=${item.bizId}`} onClick={(e) => e.stopPropagation()}>查看工单</a>] : []),
                ...(!item.isRead ? [<a key="read" onClick={(e) => { e.stopPropagation(); handleRead(item.id); }}>标记已读</a>] : []),
              ]}
            >
              <List.Item.Meta
                avatar={<span style={{ fontSize: 20 }}>{TYPE_ICONS[item.type] || '🔔'}</span>}
                title={<Space><span style={{ fontWeight: item.isRead ? 400 : 600 }}>{item.title}</span>{!item.isRead && <Badge status="processing" />}</Space>}
                description={<div><div style={{ fontSize: 12, color: '#475569' }}>{item.content}</div><div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{dayjs(item.createdAt).fromNow()} · {item.channel}</div></div>}
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
