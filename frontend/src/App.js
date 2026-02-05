import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './App.css';

const KanbanCard = ({ contact }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: contact.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="kanban-card"
    >
      <h4>{contact.company_name || contact.name}</h4>
      <p>{contact.name}</p>
      <p>{contact.custom_attributes?.['Valor_Oportunidade']}</p>
    </div>
  );
};

const KanbanColumn = ({ title, contacts }) => {
  return (
    <div className="kanban-column">
      <h3>{title}</h3>
      <SortableContext items={contacts.map(c => c.id)}>
        {contacts.map(contact => (
          <KanbanCard key={contact.id} contact={contact} />
        ))}
      </SortableContext>
    </div>
  );
};

function App() {
  const [contacts, setContacts] = useState([]);
  const columns = ["1. Inbox (Novos)", "2.Em contato", "3. Follow-up 1", "4. Follow-up 2"];

  useEffect(() => {
    axios.get('/api/contacts')
      .then(response => {
        setContacts(response.data);
      })
      .catch(error => {
        console.error('Error fetching contacts:', error);
      });
  }, []);

  const getContactsForColumn = (columnName) => {
    return contacts.filter(contact => contact.custom_attributes?.Funil_Vendas === columnName);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      const activeContact = contacts.find(c => c.id === active.id);
      const overContainer = contacts.find(c => c.id === over.id)?.custom_attributes.Funil_Vendas;

      if (activeContact && overContainer) {
        const updatedContacts = contacts.map(c => {
          if (c.id === active.id) {
            return {
              ...c,
              custom_attributes: {
                ...c.custom_attributes,
                Funil_Vendas: overContainer,
              },
            };
          }
          return c;
        });
        setContacts(updatedContacts);

        axios.put(`/api/contacts/${active.id}`, { Funil_Vendas: overContainer })
          .catch(error => {
            console.error('Error updating contact:', error);
            // Revert the change in case of an error
            setContacts(contacts);
          });
      }
    }
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="App">
        <h1>Kanban de Vendas</h1>
        <div className="kanban-board">
          {columns.map(column => (
            <KanbanColumn key={column} title={column} contacts={getContactsForColumn(column)} />
          ))}
        </div>
      </div>
    </DndContext>
  );
}

export default App;