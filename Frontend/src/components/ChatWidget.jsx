import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, MessageCircle, SendHorizonal, Sparkles, X } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { fetchProducts } from '../services/api';
import './ChatWidget.css';

const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || '254709932014';

const buildWhatsAppLink = ({ product, cartItems = [] }) => {
  const items = cartItems.length
    ? cartItems.map((item) => `${item.name} x${item.quantity} - KSh ${Number(item.price || 0).toLocaleString()}`).join('\n')
    : product
      ? `${product.name} - KSh ${Number(product.price || 0).toLocaleString()}`
      : 'I want to place an order';

  const message = encodeURIComponent(
    `Hello Sylva Technologies, I would like to place an order.\n\nSelected items:\n${items}\n\nPlease help me complete this order.`
  );

  return `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`;
};

const quickPrompts = [
  'I want to buy a laptop',
  'Help me place my order',
  'What is the delivery time?',
  'Add a product to my cart'
];

const normalizeText = (value = '') => value.toLowerCase().trim();

function findMatchingProduct(query, products) {
  const text = normalizeText(query);
  if (!text || !products.length) return null;

  return (
    products.find((product) => {
      const haystack = normalizeText(`${product.name} ${product.brand || ''} ${product.category?.name || ''} ${product.description || ''}`);
      return haystack.includes(text) || text.includes(haystack);
    }) ||
    products.find((product) => {
      const keywords = [product.name, product.brand, product.category?.name].filter(Boolean).join(' ');
      const searchable = normalizeText(keywords);
      return text.split(/\s+/).some((word) => word.length > 3 && searchable.includes(word));
    })
  );
}

function getBotReply({ message, products, addToCart, cartCount, navigate, cartItems }) {
  const text = normalizeText(message);

  if (!text) {
    return 'Tell me what you need and I’ll help you place the order.';
  }

  if (text.includes('hello') || text.includes('hi') || text.includes('hey')) {
    return "Hello! I'm Sylva, your shopping assistant. I can help you pick a product, add it to your cart, and guide you through checkout.";
  }

  if (text.includes('checkout') || text.includes('place order') || text.includes('buy now') || text.includes('pay now')) {
    if (cartCount > 0) {
      navigate('/checkout');
      return 'Your cart is ready. I’ve sent you to checkout so you can finish the order. You can also continue the order on WhatsApp if you prefer.';
    }

    return 'Your cart is empty right now. Tell me the product you want, and I’ll add it for you. If you prefer, I can also start a WhatsApp order for you.';
  }

  if (text.includes('whatsapp') || text.includes('wa ')) {
    const link = buildWhatsAppLink({ cartItems });
    window.open(link, '_blank', 'noopener,noreferrer');
    return 'I’ve opened WhatsApp with your order details so you can complete the purchase with a quick message.';
  }

  const productMatch = findMatchingProduct(text, products);
  if (productMatch && (text.includes('buy') || text.includes('add') || text.includes('order') || text.includes('need'))) {
    addToCart(productMatch);
    return `I’ve added ${productMatch.name} to your cart. If you want to complete the order, I can take you to checkout right now.`;
  }

  if (productMatch) {
    const price = Number(productMatch.price || 0).toLocaleString();
    return `${productMatch.name} is available for KSh ${price}. I can add it to your cart or help you choose a similar option.`;
  }

  if (text.includes('shipping') || text.includes('delivery') || text.includes('arrive')) {
    return 'Delivery usually takes 3–7 business days in most areas. We also offer faster service depending on stock and location.';
  }

  if (text.includes('support') || text.includes('contact') || text.includes('help')) {
    return 'You can contact us from the contact page, or I can guide you through checking out and ordering your selected item.';
  }

  if (text.includes('cart')) {
    if (cartCount > 0) {
      return `You currently have ${cartCount} item(s) in your cart. I can help you review them and continue to checkout.`;
    }
    return 'Your cart is currently empty. Tell me which product you want, and I’ll add it.';
  }

  if (text.includes('laptop') || text.includes('phone') || text.includes('headphone') || text.includes('printer') || text.includes('mouse') || text.includes('keyboard')) {
    const relevant = products.filter((item) => {
      const haystack = normalizeText(`${item.name} ${item.brand || ''} ${item.category?.name || ''}`);
      return ['laptop', 'phone', 'headphone', 'printer', 'mouse', 'keyboard'].some((keyword) => haystack.includes(keyword));
    }).slice(0, 3);

    if (relevant.length) {
      const list = relevant.map((item) => `${item.name} (KSh ${Number(item.price || 0).toLocaleString()})`).join(', ');
      return `I found a few good options: ${list}. Tell me which one you want and I’ll add it to your cart.`;
    }
  }

  if (text.includes('thank')) {
    return 'You’re welcome. I’m here to help you place your order smoothly.';
  }

  return 'I can help you choose a product, check delivery time, add items to your cart, and guide you to checkout. What would you like to order?';
}

function ChatWidget() {
  const navigate = useNavigate();
  const { addToCart, cartCount, cartItems } = useCart();
  const [isOpen, setIsOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'bot',
      text: "Hi! I’m Sylva, and I can help you browse products, add items to your cart, and complete an order."
    }
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchProducts({ limit: 50 })
      .then((data) => setProducts(data.products || []))
      .catch(() => setProducts([]));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const addMessage = (text, sender = 'user') => {
    const newMessage = {
      id: Date.now() + Math.random(),
      sender,
      text
    };

    setMessages((current) => [...current, newMessage]);
    return newMessage;
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const text = input.trim();
    if (!text) return;

    addMessage(text, 'user');
    setInput('');

    window.setTimeout(() => {
      addMessage(
        getBotReply({
          message: text,
          products,
          addToCart,
          cartCount,
          navigate,
          cartItems,
        }),
        'bot'
      );
    }, 300);
  };

  const handleQuickPrompt = (prompt) => {
    addMessage(prompt, 'user');
    window.setTimeout(() => {
      addMessage(
        getBotReply({
          message: prompt,
          products,
          addToCart,
          cartCount,
          navigate,
          cartItems,
        }),
        'bot'
      );
    }, 250);
  };

  return (
    <div className="chat-widget">
      <button
        type="button"
        className="chat-toggle"
        onClick={() => setIsOpen((current) => !current)}
        aria-label="Toggle Sylva chat"
      >
        <span className="chat-toggle__badge">
          <MessageCircle size={18} />
        </span>
        <span className="chat-toggle__label">Sylva</span>
      </button>

      {isOpen && (
        <div className="chat-panel" role="dialog" aria-label="Sylva chat assistant">
          <div className="chat-panel__header">
            <div className="chat-panel__brand">
              <div className="chat-panel__avatar">
                <Bot size={18} />
              </div>
              <div>
                <strong>Sylva</strong>
                <small>Online now</small>
              </div>
            </div>
            <button
              type="button"
              className="chat-panel__close"
              onClick={() => setIsOpen(false)}
              aria-label="Close chat"
            >
              <X size={18} />
            </button>
          </div>

          <div className="chat-panel__body">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`chat-message chat-message--${message.sender}`}
              >
                {message.sender === 'bot' && (
                  <span className="chat-message__icon">
                    <Sparkles size={14} />
                  </span>
                )}
                <p>{message.text}</p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-panel__suggestions">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="chat-panel__suggestion"
                onClick={() => handleQuickPrompt(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className="chat-panel__actions">
            <a
              className="chat-wa-button"
              href={buildWhatsAppLink({ cartItems })}
              target="_blank"
              rel="noreferrer"
            >
              Order on WhatsApp
            </a>
          </div>

          <form className="chat-panel__form" onSubmit={handleSubmit}>
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask Sylva..."
              aria-label="Ask Sylva"
            />
            <button type="submit" aria-label="Send message">
              <SendHorizonal size={17} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default ChatWidget;
