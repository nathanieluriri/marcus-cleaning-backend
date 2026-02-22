
from bson import ObjectId
from fastapi import HTTPException
from typing import List

from repositories.customer_repo import (
    create_user,
    get_user,
    get_users,
    update_user,
    delete_user,
)
from schemas.customer_schema import CustomerCreate, CustomerUpdate, CustomerOut,CustomerBase,CustomerRefresh
from security.hash import check_password
from repositories.tokens_repo import get_refresh_tokens,delete_access_token,delete_refresh_token,delete_all_tokens_with_user_id
from services.auth_helpers import issue_tokens_for_user
from authlib.integrations.starlette_client import OAuth
import os
from dotenv import load_dotenv


load_dotenv()

 
oauth = OAuth()
oauth.register(
    name='google',
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'},
)
async def add_user(user_data: CustomerCreate) -> CustomerOut:
    """adds an entry of CustomerCreate to the database and returns an object

    Returns:
        _type_: CustomerOut
    """
    customer =  await get_user(filter_dict={"email":user_data.email})
    if customer==None:
        new_user= await create_user(user_data)
        access_token, refresh_token = await issue_tokens_for_user(user_id=new_user.id, role="customer") # type: ignore
        new_user.password=""
        new_user.access_token= access_token
        new_user.refresh_token = refresh_token
        return new_user
    else:
        raise HTTPException(status_code=409,detail="Customer Already exists")

async def authenticate_user(user_data:CustomerBase )->CustomerOut:
    customer = await get_user(filter_dict={"email":user_data.email})

    if customer != None:
        if check_password(password=user_data.password,hashed=customer.password ): # type: ignore
            customer.password=""
            access_token, refresh_token = await issue_tokens_for_user(user_id=customer.id, role="customer") # type: ignore
            customer.access_token= access_token
            customer.refresh_token = refresh_token
            return customer
        else:
            raise HTTPException(status_code=401, detail="Unathorized, Invalid Login credentials")
    else:
        raise HTTPException(status_code=404,detail="Customer not found")

async def refresh_user_tokens_reduce_number_of_logins(user_refresh_data:CustomerRefresh,expired_access_token):
    refreshObj= await get_refresh_tokens(user_refresh_data.refresh_token)
    if refreshObj:
        if refreshObj.previousAccessToken==expired_access_token:
            customer = await get_user(filter_dict={"_id":ObjectId(refreshObj.userId)})
            
            if customer!= None:
                    access_token, refresh_token = await issue_tokens_for_user(user_id=customer.id, role="customer") # type: ignore
                    customer.access_token= access_token
                    customer.refresh_token = refresh_token
                    await delete_access_token(accessToken=expired_access_token)
                    await delete_refresh_token(refreshToken=user_refresh_data.refresh_token)
                    return customer
     
        await delete_refresh_token(refreshToken=user_refresh_data.refresh_token)
        await delete_access_token(accessToken=expired_access_token)
  
    raise HTTPException(status_code=404,detail="Invalid refresh token ")  
        
async def remove_user(user_id: str):
    """deletes a field from the database and removes UserCreateobject 

    Raises:
        HTTPException 400: Invalid customer ID format
        HTTPException 404:  Customer not found
    """
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid customer ID format")

    filter_dict = {"_id": ObjectId(user_id)}
    result = await delete_user(filter_dict)
    await delete_all_tokens_with_user_id(userId=user_id)

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Customer not found")


async def retrieve_user_by_user_id(id: str) -> CustomerOut:
    """Retrieves customer object based specific Id 

    Raises:
        HTTPException 404(not found): if  Customer not found in the db
        HTTPException 400(bad request): if  Invalid customer ID format

    Returns:
        _type_: CustomerOut
    """
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid customer ID format")

    filter_dict = {"_id": ObjectId(id)}
    result = await get_user(filter_dict)

    if not result:
        raise HTTPException(status_code=404, detail="Customer not found")

    return result


async def retrieve_users(start=0,stop=100) -> List[CustomerOut]:
    """Retrieves CustomerOut Objects in a list

    Returns:
        _type_: CustomerOut
    """
    return await get_users(start=start,stop=stop)

async def update_user_by_id(user_id: str, user_data: CustomerUpdate, is_password_getting_changed: bool = False) -> CustomerOut:
    """updates an entry of customer in the database

    Raises:
        HTTPException 404(not found): if Customer not found or update failed
        HTTPException 400(not found): Invalid customer ID format

    Returns:
        _type_: CustomerOut
    """
    from core.queue.manager import QueueManager
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid customer ID format")

    filter_dict = {"_id": ObjectId(user_id)}
    result = await update_user(filter_dict, user_data)
    
    if not result:
        raise HTTPException(status_code=404, detail="Customer not found or update failed")
    if is_password_getting_changed is True:
        QueueManager.get_instance().enqueue("delete_tokens", {"userId": user_id})
    return result

async def authenticate_user_google(user_data: CustomerBase) -> CustomerOut:
    customer = await get_user(filter_dict={"email": user_data.email})

    if customer is None:
        new_user = await create_user(CustomerCreate(**user_data.model_dump()))
        customer = new_user

    access_token, refresh_token = await issue_tokens_for_user(user_id=customer.id, role="customer") # type: ignore
    customer.password = ""
    customer.access_token = access_token
    customer.refresh_token = refresh_token
    return customer

